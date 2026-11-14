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
import { RunningDelegations } from '../models/running-delegations.model.js';
import type { SessionContext } from '../models/session-context.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult, TurnStatus } from '../models/turn-result.model.js';
import type { AnsweredQuestion, RestoredWorkAnswers } from '../models/user-question.model.js';
import type { AnswerDelivery, ValidatedDecision, ValidatedDelegation } from '../models/validated-delegation.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { IPreferencesStorePort } from '../ports/preferences-store.port.js';
import { buildAttachmentsPrompt } from '../prompts/attachments.prompt.js';
import { buildCeoSteeringPrompt } from '../prompts/ceo-steering.prompt.js';
import { buildDelegationRepairPrompt } from '../prompts/delegation-repair.prompt.js';
import { buildPreviousTurnPrompt, describeDelegation } from '../prompts/previous-turn.prompt.js';
import { buildResumedWorkPrompt } from '../prompts/resumed-work.prompt.js';
import { buildUserAnswersPrompt } from '../prompts/user-answers.prompt.js';
import { DEFAULT_USER_LANGUAGE } from '../prompts/user-language.prompt.js';
import { AgentProtocolService } from '../services/agent-protocol.service.js';
import { AgentRoundService } from '../services/agent-round.service.js';
import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';
import { DelegationDetectorService } from '../services/delegation-detector.service.js';
import { DelegationValidatorService } from '../services/delegation-validator.service.js';
import { OpenWorkService } from '../services/open-work.service.js';
import { TeamProfilesService } from '../services/team-profiles.service.js';
import { previewForLog } from '../utils/log-preview.util.js';
import { isPromptCancellation } from '../utils/prompt-cancellation.util.js';
import { extractUserLanguage } from '../utils/user-language.util.js';

import { AnswerAgentQuestionsUseCase } from './answer-agent-questions.use-case.js';
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
 * Runs a turn of the conversation on the CEO: its rounds, the repair of an invalid response, its questions to the
 * user, and the delegations it starts, until it answers the user. A message that arrives while the CEO works steers
 * it, and work a restart interrupted is resumed from where it stopped.
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
    private readonly openWork: OpenWorkService,
    private readonly logContext: ConversationLogContextService,
    private readonly audioTranscription: TranscribeAudioAttachmentsUseCase,
    private readonly agentQuestions: AnswerAgentQuestionsUseCase,
    private readonly runAgentRequests: RunAgentRequestsUseCase,
    private readonly runDelegation: RunDelegationUseCase,
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

    try {
      if (resumed && !resumed.work.root) {
        session = await this.agentRound.resolveSession(request);
        observers.onSessionResolved(session);
        running.add(this.runDelegation.start(session, [await this.toResumedDelegation(resumed, request)], request, resumed.work.round, conversationKey, running));
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
            if (block.signature !== lastBlockSignature) {
              prompt = `${block.text}\n${prompt}`;
            }
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
          return await finish('completed', decision.message, undefined, decision.attachments);
        }

        if (decision.kind === 'delegate') {
          if (++delegationRounds >= this.MAX_DELEGATION_ROUNDS) {
            for (const { delegateToRole, projectName, taskSpec } of decision.delegations) {
              this.conversationRuntime.addCeoNotice(conversationKey, `${describeDelegation(delegateToRole, projectName ?? null, taskSpec)} never started.`);
            }
            return await finish('failed', 'Delegation limit reached.', 'Max delegation rounds exceeded.');
          }
          running.add(this.runDelegation.start(session!, decision.delegations, request, round, conversationKey, running));
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
    const reminder = this.agentRegistry.getTurnReminder(request.agentRole);
    const languagePrompt = await this.agentRound.buildLanguagePrompt(request.agentRole, request.agentRole);
    const block = (await this.teamProfiles.build(conversationKey, request)).text;
    const steered = await this.conversationRuntime.steerCeo(
      conversationKey,
      agentId,
      [block, prompt, reminder, languagePrompt].filter(Boolean).join('\n\n'),
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
    const runRound = async (text: string, isUserText = false, delivery?: AnswerDelivery) => this.takeUserLanguage(await this.agentRound.run({
      agentPort: ceoPort,
      cwd: request.workspacePath,
      role: request.agentRole,
      prompt: text,
      request,
      turn,
      session,
      isUserMessage: isUserText,
      answerDelivery: delivery,
    }));
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

    let response = await runCeo(prompt, isUserMessage, answerDelivery);
    for (;;) {
      let decision = await this.delegationValidator.decide(response, request);
      for (let attempt = 1; decision.kind === 'invalid' && attempt <= this.MAX_REPAIR_ATTEMPTS; attempt++) {
        this.logger.warn(
          `[Delegation Repair] Conversation=${session.conversationId}, Attempt=${attempt}: ${decision.reason}`,
        );
        request.onDraft?.('');
        response = await runCeo(buildDelegationRepairPrompt(decision.reason));
        decision = await this.delegationValidator.decide(response, request);
      }
      if (decision.kind !== 'ask') {
        const requestResults = pending.take();
        return { response, decision, ...(requestResults ? { requestResults } : {}) };
      }

      const answers = await this.agentQuestions.ask(request, this.agentQuestions.askerFor(request.agentRole, undefined), decision.message, decision.questions, workId);
      response = await runCeo(buildUserAnswersPrompt(answers), true);
    }
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
