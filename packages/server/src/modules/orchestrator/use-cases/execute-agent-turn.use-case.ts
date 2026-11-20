import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import type { IAgentPort } from '../../agent/ports/agent.port.js';
import { IFileSystemPort } from '../../agent/ports/file-system.port.js';
import { ConversationLogContextService } from '../../logging/services/conversation-log-context.service.js';
import { ATTACHMENTS_ONLY_PROMPT } from '../constants/attachments-only-prompt.constant.js';
import type { ActiveTurn } from '../models/active-turn.model.js';
import type { AgentRequester } from '../models/agent-request.model.js';
import type { OpenWork } from '../models/open-work.model.js';
import { PendingRequestResults } from '../models/pending-request-results.model.js';
import { RetryBudget } from '../models/retry-budget.model.js';
import { RunningDelegations } from '../models/running-delegations.model.js';
import type { SessionContext } from '../models/session-context.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult, TurnStatus } from '../models/turn-result.model.js';
import type { RetryMessage } from '../models/turn-retry.model.js';
import type { AnsweredQuestion, RestoredWorkAnswers } from '../models/user-question.model.js';
import type { AnswerDelivery, ValidatedDecision, ValidatedDelegation } from '../models/validated-delegation.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { IPreferencesStorePort } from '../ports/preferences-store.port.js';
import { buildAttachmentsPrompt } from '../prompts/attachments.prompt.js';
import { buildBoardCheckPrompt } from '../prompts/board.prompt.js';
import { buildCeoSteeringPrompt } from '../prompts/ceo-steering.prompt.js';
import { buildDelegationRepairPrompt } from '../prompts/delegation-repair.prompt.js';
import { buildPreviousTurnPrompt, describeDelegation } from '../prompts/previous-turn.prompt.js';
import { buildResumedWorkPrompt } from '../prompts/resumed-work.prompt.js';
import { buildTurnRetryPrompt } from '../prompts/turn-retry.prompt.js';
import { buildUserAnswersPrompt } from '../prompts/user-answers.prompt.js';
import { DEFAULT_USER_LANGUAGE } from '../prompts/user-language.prompt.js';
import { AgentProtocolService } from '../services/agent-protocol.service.js';
import { AgentRoundService } from '../services/agent-round.service.js';
import { CeoBoardService } from '../services/ceo-board.service.js';
import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';
import { DelegationDetectorService } from '../services/delegation-detector.service.js';
import { DelegationValidatorService } from '../services/delegation-validator.service.js';
import { OpenWorkService } from '../services/open-work.service.js';
import { TeamProfilesService } from '../services/team-profiles.service.js';
import { previewForLog } from '../utils/log-preview.util.js';
import { isPromptCancellation } from '../utils/prompt-cancellation.util.js';
import { extractUserLanguage } from '../utils/user-language.util.js';

import { AnswerAgentQuestionsUseCase } from './answer-agent-questions.use-case.js';
import { type PrepareRetryMessage, RetryCeoRoundUseCase } from './retry-ceo-round.use-case.js';
import { RunAgentRequestsUseCase } from './run-agent-requests.use-case.js';
import { RunDelegationUseCase } from './run-delegation.use-case.js';
import { TranscribeAudioAttachmentsUseCase } from './transcribe-audio-attachments.use-case.js';


const FILE_URL_PREFIX = 'file://';

/** Work a restart interrupted, with the answers when the agent had asked and the user has answered since. */
type Resumption = {
  readonly work: OpenWork;
  readonly answers?: readonly AnsweredQuestion[];
};

type CeoRoundDecision = Exclude<ValidatedDecision, { kind: 'ask' }>;

/**
 * Runs a turn of the conversation on the CEO: its rounds, the repair of an invalid response, the retries of a prompt
 * that fails, its questions to the user, and the delegations it starts, until it answers the user. A message that
 * arrives while the CEO works steers it, and work a restart interrupted is resumed from where it stopped.
 */
@Injectable()
export class ExecuteAgentTurnUseCase {
  private readonly logger = new Logger(ExecuteAgentTurnUseCase.name);
  private readonly MAX_DELEGATION_ROUNDS = 1000;
  private readonly MAX_REPAIR_ATTEMPTS = 1;

  constructor(
    @Inject(IAgentPortFactory) private readonly agentPortFactory: IAgentPortFactory,
    @Inject(IAgentRegistryPort) private readonly agentRegistry: IAgentRegistryPort,
    @Inject(IPreferencesStorePort) private readonly preferencesStore: IPreferencesStorePort,
    @Inject(IFileSystemPort) private readonly fileSystem: IFileSystemPort,
    private readonly delegationDetector: DelegationDetectorService,
    private readonly delegationValidator: DelegationValidatorService,
    private readonly conversationRuntime: ConversationRuntimeService,
    private readonly agentProtocol: AgentProtocolService,
    private readonly agentRound: AgentRoundService,
    private readonly teamProfiles: TeamProfilesService,
    private readonly ceoBoard: CeoBoardService,
    private readonly openWork: OpenWorkService,
    private readonly logContext: ConversationLogContextService,
    private readonly audioTranscription: TranscribeAudioAttachmentsUseCase,
    private readonly agentQuestions: AnswerAgentQuestionsUseCase,
    private readonly runAgentRequests: RunAgentRequestsUseCase,
    private readonly runDelegation: RunDelegationUseCase,
    private readonly retryCeoRound: RetryCeoRoundUseCase,
  ) {}

  execute(request: TurnRequest): Promise<TurnResult> {
    return this.logContext.run(request.conversationId, () => this.executeTurn(request));
  }

  /** Claims the work before anything else runs, so a second request for it finds it taken. */
  resume(workId: string, request: TurnRequest): Promise<TurnResult> {
    const work = this.openWork.claimStopped(request.conversationId, workId);
    return work ? this.executeResumption(request, { work }) : this.noWork(workId);
  }

  deliverAnswers({ workId, answers }: RestoredWorkAnswers, request: TurnRequest): Promise<TurnResult> {
    const work = this.openWork.claimAsked(request.conversationId, workId);
    return work ? this.executeResumption(request, { work, answers }) : this.noWork(workId);
  }

  private executeResumption(request: TurnRequest, resumption: Resumption): Promise<TurnResult> {
    return this.logContext.run(request.conversationId, () => this.executeTurn({ ...request, prompt: '', resumable: true }, resumption));
  }

  private noWork(workId: string): Promise<TurnResult> {
    return Promise.resolve({ response: '', status: 'failed', errorMessage: `No interrupted work: ${workId}` });
  }

  private async executeTurn(request: TurnRequest, resumed?: Resumption): Promise<TurnResult> {
    const conversationKey = request.conversationId;
    const endTurn = this.conversationRuntime.beginTurn(conversationKey);
    try {
      return await this.runTurn(conversationKey, await this.transcribeAudio(request), resumed);
    } finally {
      endTurn();
    }
  }

  /**
   * Audio attachments become text before any agent sees the message, whichever channel sent it: the
   * transcripts join the prompt and the audio files leave the attachments. The channel is told what was
   * transcribed, and what could not be, through `onTranscription`.
   */
  private async transcribeAudio(request: TurnRequest): Promise<TurnRequest> {
    const { prompt, attachments, transcripts, warnings } = await this.audioTranscription.execute({
      prompt: request.prompt,
      attachments: request.attachments,
    });
    if (transcripts.length > 0 || warnings.length > 0) {
      request.onTranscription?.({ transcripts, warnings });
    }
    return {
      ...request,
      prompt: prompt.trim() === '' && attachments.length > 0 ? ATTACHMENTS_ONLY_PROMPT : prompt,
      attachments,
    };
  }

  /** What the user wrote to ask for a retry is read like any message: audio becomes text, the other files are listed. */
  private async prepareRetryMessage(request: TurnRequest, { text, attachments }: RetryMessage): Promise<string | undefined> {
    const message = await this.transcribeAudio({ ...request, prompt: text, attachments });
    return buildAttachmentsPrompt(message.prompt, message.attachments).trim() || undefined;
  }

  private async runTurn(
    conversationKey: string,
    request: TurnRequest,
    resumed?: Resumption,
  ): Promise<TurnResult> {
    let session: SessionContext | undefined;
    let ceoPort: IAgentPort | undefined;
    let agentId: string | undefined;
    const currentCeoPort = () => ceoPort ?? this.conversationRuntime.getCeoPort(conversationKey);
    const finish = (status: TurnStatus, response: string, errorMessage?: string, attachments: readonly string[] = []) => {
      if (status === 'cancelled') {
        this.conversationRuntime.addCeoNotice(conversationKey, 'Your previous turn was cancelled.');
      } else if (status === 'failed') {
        this.conversationRuntime.addCeoNotice(conversationKey, `Your previous turn failed: ${errorMessage}`);
      }
      return this.buildResult({
        ceoPort: currentCeoPort(),
        agentId: agentId ?? this.agentPortFactory.defaultAgentId,
        role: request.agentRole,
        status,
        response,
        errorMessage,
        attachments,
        workspacePath: request.workspacePath,
        conversationId: request.conversationId,
      });
    };

    try {
      agentId = await this.agentRound.resolveAgentId(request.conversationId, request.agentRole);
      if (!resumed && await this.steerRunningCeo(conversationKey, agentId, request)) {
        return await this.buildSteeredResult(conversationKey, request);
      }
      return await this.runDelegationLoop(
        conversationKey,
        agentId,
        request,
        finish,
        {
          onSessionResolved: (resolved) => {
            session = resolved;
          },
          onCeoPort: (port) => {
            ceoPort = port;
          },
        },
        resumed,
      );
    } catch (error) {
      const conversationLabel = session?.conversationId ?? 'none';
      if (isPromptCancellation(error)) {
        this.logger.warn(`[Turn Cancelled] Active turn was cancelled for conversation=${conversationLabel}`);
        return finish('cancelled', this.agentProtocol.finalResponse(currentCeoPort()?.lastAgentMessage ?? ''));
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[Turn Failed] Conversation=${conversationLabel}: ${errorMessage}`);

      return finish('failed', this.agentProtocol.finalResponse(currentCeoPort()?.lastAgentMessage ?? ''), errorMessage);
    }
  }

  private async runDelegationLoop(
    conversationKey: string,
    agentId: string,
    request: TurnRequest,
    finish: (status: TurnStatus, response: string, errorMessage?: string, attachments?: readonly string[]) => Promise<TurnResult>,
    observers: {
      readonly onSessionResolved: (session: SessionContext) => void;
      readonly onCeoPort: (ceoPort: IAgentPort) => void;
    },
    resumed?: Resumption,
  ): Promise<TurnResult> {
    let session: SessionContext | undefined;
    let prompt = buildAttachmentsPrompt(request.prompt, request.attachments);
    const running = new RunningDelegations();
    let lastBlockSignature: string | undefined;
    let delegationRounds = 0;
    const resumedRoot = resumed?.work.root ? resumed : undefined;
    const ceoWorkId = request.resumable ? resumedRoot?.work.id ?? randomUUID() : undefined;
    let ceoAnswerDelivery = resumedRoot && this.answerDeliveryOf(resumedRoot);
    /** The tasks this turn started delegations for, restored work included: the ones the board check looks at. */
    const delegatedArtifacts = new Set<string>();
    let boardChecked = false;

    try {
      if (resumed && !resumed.work.root) {
        session = await this.agentRound.resolveSession(request);
        observers.onSessionResolved(session);
        const restored = await this.toResumedDelegation(resumed, request);
        running.add(this.runDelegation.start(session, [restored], request, resumed.work.round, conversationKey, running));
        this.trackArtifacts(delegatedArtifacts, [restored]);
        await this.openWork.discardInterruptedRoots(request.conversationId);
        const results = await running.nextResults();
        if (results === undefined) {
          return await finish('steered', '');
        }
        prompt = results;
      } else if (resumedRoot) {
        prompt = await this.firstPromptOf(resumedRoot, request);
      }
      if (ceoWorkId) {
        await this.openWork.discardInterruptedRoots(request.conversationId);
        await this.openWork.open(request.conversationId, {
          id: ceoWorkId,
          role: request.agentRole,
          roleName: this.agentRegistry.getDisplayName(request.agentRole),
          projectName: null,
          summary: '',
          taskSpec: resumedRoot?.work.taskSpec ?? prompt,
          ...(ceoAnswerDelivery ? { questions: ceoAnswerDelivery.questions } : {}),
          cwd: request.workspacePath,
          round: 1,
          root: true,
        });
      }
      for (let round = 1; ; round++) {
        let deliveredNotices = 0;
        const { response, decision, requestResults } = await this.conversationRuntime.runOnCeo(
          conversationKey,
          agentId,
          async (ceoPort, turn) => {
            observers.onCeoPort(ceoPort);
            if (!session) {
              session = await this.agentRound.resolveSession(request);
              observers.onSessionResolved(session);
              this.logger.log(
                `[Turn Started] User=${request.userId}, Conversation=${request.conversationId}, Role=${request.agentRole}`,
              );
            }
            const block = await this.teamProfiles.build(conversationKey, request);
            // Each <agent_result> carries the status it left, so the board goes only with the round that opens the turn.
            const board = round === 1 ? `${await this.ceoBoard.buildPrompt(request.conversationId)}\n` : '';
            const team = block.signature !== lastBlockSignature ? `${block.text}\n` : '';
            prompt = `${team}${board}${prompt}`;
            lastBlockSignature = block.signature;
            const notices = this.conversationRuntime.pendingCeoNotices(conversationKey);
            if (notices.length > 0) {
              prompt = `${buildPreviousTurnPrompt(notices)}\n${prompt}`;
              deliveredNotices = notices.length;
            }
            const answerDelivery = ceoAnswerDelivery;
            ceoAnswerDelivery = undefined;
            return this.runCeoTurn(ceoPort, prompt, request, turn, session, round === 1, ceoWorkId, answerDelivery);
          },
          round === 1 ? request.onQueued : undefined,
        );
        this.conversationRuntime.acknowledgeCeoNotices(conversationKey, deliveredNotices);

        if (decision.kind === 'invalid') {
          return await finish('failed', response, `Invalid CEO response: ${decision.reason}`);
        }

        if (decision.kind === 'reply' && running.isEmpty) {
          const stranded = boardChecked ? [] : await this.ceoBoard.findStranded(request.conversationId, decision.message, delegatedArtifacts);
          if (stranded.length === 0) {
            return await finish('completed', decision.message, undefined, decision.attachments);
          }
          boardChecked = true;
          this.logger.log(`[Board Check] Conversation=${request.conversationId}, Tasks=${stranded.map(task => task.id).join(',')}`);
          request.onDraft?.('');
          const check = buildBoardCheckPrompt(stranded);
          prompt = requestResults ? `${requestResults}\n\n${check}` : check;
          continue;
        }

        if (decision.kind === 'delegate') {
          if (++delegationRounds >= this.MAX_DELEGATION_ROUNDS) {
            for (const { delegateToRole, projectName, taskSpec } of decision.delegations) {
              this.conversationRuntime.addCeoNotice(conversationKey, `${describeDelegation(delegateToRole, projectName ?? null, taskSpec)} never started.`);
            }
            return await finish('failed', 'Delegation limit reached.', 'Max delegation rounds exceeded.');
          }
          running.add(this.runDelegation.start(session!, decision.delegations, request, round, conversationKey, running));
          this.trackArtifacts(delegatedArtifacts, decision.delegations);
        }
        if (decision.message) {
          request.onInterimMessage?.(decision.message);
        }
        const results = await running.nextResults();
        // Another turn replaced every agent this one was waiting for, and that turn answers the user.
        if (results === undefined) {
          return await finish('steered', '');
        }
        prompt = requestResults ? `${requestResults}\n\n${results}` : results;
      }
    } finally {
      await this.runDelegation.stopRunning(running, conversationKey);
      if (ceoWorkId) {
        await this.openWork.close(request.conversationId, ceoWorkId);
      }
    }
  }

  private trackArtifacts(tracked: Set<string>, delegations: readonly ValidatedDelegation[]): void {
    for (const { artifactId } of delegations) {
      if (artifactId) {
        tracked.add(artifactId);
      }
    }
  }

  private async toResumedDelegation(resumption: Resumption, request: TurnRequest): Promise<ValidatedDelegation> {
    const { work } = resumption;
    const answerDelivery = this.answerDeliveryOf(resumption);
    return {
      delegateToRole: work.role,
      projectName: work.projectName ?? undefined,
      taskSpec: work.taskSpec,
      summary: work.summary,
      ...(work.artifactId ? { artifactId: work.artifactId } : {}),
      sessionMode: 'resume',
      cwd: work.cwd,
      workId: work.id,
      firstPrompt: await this.firstPromptOf(resumption, request),
      ...(answerDelivery ? { answerDelivery } : {}),
    };
  }

  private answerDeliveryOf({ work, answers }: Resumption): AnswerDelivery | undefined {
    return answers && work.questions ? { workId: work.id, questions: work.questions, taskSpec: work.taskSpec } : undefined;
  }

  /** An agent that asked gets its answers like any other; only one that stopped mid-round is told it was interrupted. */
  private async firstPromptOf({ work, answers }: Resumption, request: TurnRequest): Promise<string> {
    return answers
      ? buildUserAnswersPrompt(await this.agentQuestions.transcribe(request, answers))
      : buildResumedWorkPrompt(work.taskSpec);
  }

  private async steerRunningCeo(
    conversationKey: string,
    agentId: string,
    request: TurnRequest,
  ): Promise<boolean> {
    const prompt = buildCeoSteeringPrompt(buildAttachmentsPrompt(request.prompt, request.attachments));
    const languagePrompt = await this.agentRound.buildLanguagePrompt(request.agentRole, request.agentRole);
    const block = (await this.teamProfiles.build(conversationKey, request)).text;
    const board = await this.ceoBoard.buildPrompt(request.conversationId);
    const steered = await this.conversationRuntime.steerCeo(
      conversationKey,
      agentId,
      [`${block}\n${board}`, prompt, languagePrompt].filter(Boolean).join('\n\n'),
    );
    if (steered) {
      this.logger.log(
        `[CEO Steered] Conversation=${conversationKey}, User=${request.userId}, Prompt="${previewForLog(request.prompt)}"`,
      );
    }
    return steered;
  }

  private async buildSteeredResult(conversationKey: string, request: TurnRequest): Promise<TurnResult> {
    const ceoPort = this.conversationRuntime.getCeoPort(conversationKey)!;
    return {
      response: '',
      status: 'steered',
      agentInfo: await this.agentRound.buildAgentInfo(ceoPort, request.agentRole, request.conversationId),
    };
  }

  private async runCeoTurn(
    ceoPort: IAgentPort,
    prompt: string,
    request: TurnRequest,
    turn: ActiveTurn,
    session: SessionContext,
    isUserMessage: boolean,
    workId: string | undefined,
    answerDelivery: AnswerDelivery | undefined,
  ): Promise<{ response: string; decision: CeoRoundDecision; requestResults?: string }> {
    const prepareRetryMessage: PrepareRetryMessage = message => this.prepareRetryMessage(request, message);
    const runRound = (text: string, isUserText = false, delivery?: AnswerDelivery) => this.retryCeoRound.execute(
      request,
      async retry => this.takeUserLanguage(await this.agentRound.run({
        agentPort: ceoPort,
        cwd: request.workspacePath,
        role: request.agentRole,
        prompt: retry ? buildTurnRetryPrompt(retry, text) : text,
        request,
        turn,
        session,
        isUserMessage: isUserText,
        answerDelivery: delivery,
      })),
      prepareRetryMessage,
    );
    const requester: AgentRequester = {
      role: request.agentRole,
      roleName: this.agentRegistry.getDisplayName(request.agentRole),
      conversationId: request.conversationId,
    };
    const pending = new PendingRequestResults();
    const runCeo = async (text: string, isUserText = false, delivery?: AnswerDelivery) => pending.keep(await this.runAgentRequests.resolve(
      await runRound(pending.before(text), isUserText, delivery),
      (results) => {
        request.onDraft?.('');
        return runRound(results);
      },
      requester,
      rest => this.delegationDetector.detect(rest).kind !== 'reply',
      activity => request.onActivity?.(activity, requester.role),
    ));

    const repairPauses = new RetryBudget();

    /**
     * `userInitiated` is whether the CEO is answering the user, which a delegation that only the user may start requires.
     * A response that stays invalid after its repairs waits for a retry, which asks for the repair again with a new budget.
     */
    const decide = async (response: string, userInitiated: boolean, attempt = 1): Promise<{ response: string; decision: ValidatedDecision }> => {
      const decision = await this.delegationValidator.decide(response, request, userInitiated);
      if (decision.kind !== 'invalid') {
        return { response, decision };
      }
      let repair = buildDelegationRepairPrompt(decision.reason);
      let nextAttempt = attempt + 1;
      if (attempt > this.MAX_REPAIR_ATTEMPTS) {
        const retry = await this.retryCeoRound.pause(request, `Invalid CEO response: ${decision.reason}`, repairPauses, prepareRetryMessage);
        if (!retry) {
          return { response, decision };
        }
        repair = buildTurnRetryPrompt(retry, repair);
        nextAttempt = 1;
      }
      this.logger.warn(
        `[Delegation Repair] Conversation=${session.conversationId}, Attempt=${attempt}: ${decision.reason}`,
      );
      request.onDraft?.('');
      return decide(await runCeo(repair), userInitiated, nextAttempt);
    };

    const settle = async (response: string, userInitiated: boolean): Promise<{ response: string; decision: CeoRoundDecision; requestResults?: string }> => {
      const settled = await decide(response, userInitiated);
      if (settled.decision.kind !== 'ask') {
        const requestResults = pending.take();
        return { response: settled.response, decision: settled.decision, ...(requestResults ? { requestResults } : {}) };
      }

      const answers = await this.agentQuestions.ask(request, this.agentQuestions.askerFor(request.agentRole, undefined), settled.decision.message, settled.decision.questions, workId);
      return settle(await runCeo(buildUserAnswersPrompt(answers), true), true);
    };

    return settle(await runCeo(prompt, isUserMessage, answerDelivery), isUserMessage);
  }

  /**
   * Without a stored language the CEO was asked to detect it, so its first response settles the language, falling
   * back to English when it carries no tag.
   */
  private async takeUserLanguage(response: string): Promise<string> {
    const { language, text } = extractUserLanguage(response);
    if (!(await this.preferencesStore.load()).language) {
      const stored = language ?? DEFAULT_USER_LANGUAGE;
      await this.preferencesStore.update({ language: stored });
      this.logger.log(`[User Language Stored] Language=${stored}, Detected=${language !== undefined}`);
    }
    return text;
  }

  private async buildResult(input: {
    ceoPort?: IAgentPort;
    agentId: string;
    role: string;
    status: TurnStatus;
    response: string;
    errorMessage?: string;
    attachments: readonly string[];
    workspacePath: string;
    conversationId: string;
  }): Promise<TurnResult> {
    const attachments = this.resolveAttachmentPaths(input.attachments, input.workspacePath);
    return {
      response: input.response,
      status: input.status,
      errorMessage: input.errorMessage,
      agentInfo: input.ceoPort
        ? await this.agentRound.buildAgentInfo(input.ceoPort, input.role, input.conversationId)
        : { roleName: this.agentRegistry.getDisplayName(input.role), agentName: input.agentId },
      usage: await input.ceoPort?.getLastRoundUsage().catch(() => undefined),
      ...(attachments.length > 0 ? { attachments } : {}),
    };
  }

  /** Resolves the attachment paths the CEO wrote, keeping only the regular files that exist, without duplicates. */
  private resolveAttachmentPaths(paths: readonly string[], baseDir: string): string[] {
    const resolved = new Set<string>();
    for (const rawPath of paths) {
      const path = this.toFilePath(rawPath.trim());
      const absolutePath = isAbsolute(path) ? path : resolve(baseDir, path);
      if (this.fileSystem.isReadableFile(absolutePath)) {
        resolved.add(absolutePath);
      }
    }
    return [...resolved];
  }

  /** A file URL percent-encodes characters such as spaces, which the file name on disk does not have. */
  private toFilePath(path: string): string {
    if (!path.startsWith(FILE_URL_PREFIX)) {
      return path;
    }
    try {
      return fileURLToPath(path);
    } catch {
      return path.slice(FILE_URL_PREFIX.length);
    }
  }
}
