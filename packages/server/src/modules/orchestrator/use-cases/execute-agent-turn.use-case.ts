import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import {
  PromptCancelledError,
  IAgentPort,
} from '../../agent/ports/agent.port.js';
import { IFileSystemPort } from '../../agent/ports/file-system.port.js';
import { runInLogConversation } from '../../logging/utils/log-conversation.util.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import { ATTACHMENTS_ONLY_PROMPT } from '../constants/attachments-only-prompt.constant.js';
import { PLANS_DIRECTORY_NAME, PLANS_NO_PROJECT_FOLDER } from '../constants/plans-directory.constant.js';
import type { ActiveDelegation } from '../models/active-delegation.model.js';
import { ActiveTurn } from '../models/active-turn.model.js';
import type { AgentSession } from '../models/agent-session.model.js';
import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';
import type { AudioTranscript } from '../models/audio-transcription.model.js';
import type { OpenWork, OpenWorkQuestions } from '../models/open-work.model.js';
import { type DelegationOutcome, RunningDelegations, type StartedDelegation } from '../models/running-delegations.model.js';
import type { SessionContext } from '../models/session-context.model.js';
import type { TurnAgentInfo } from '../models/turn-agent-info.model.js';
import type { TurnAttachment } from '../models/turn-attachment.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult, TurnStatus } from '../models/turn-result.model.js';
import type {
  AnsweredQuestion,
  RestoredWorkAnswers, QuestionAsker, UserQuestion,
} from '../models/user-question.model.js';
import {
  type DelegationContract,
  IAgentRegistryPort,
} from '../ports/agent-registry.port.js';
import { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';
import { IPreferencesStorePort } from '../ports/preferences-store.port.js';
import { ISessionStorePort } from '../ports/session-store.port.js';
import { buildCeoSteeringPrompt } from '../prompts/ceo-steering.prompt.js';
import { buildDelegationRepairPrompt } from '../prompts/delegation-repair.prompt.js';
import { buildPlansDirectoryPrompt } from '../prompts/plans-directory.prompt.js';
import { buildPreviousTurnPrompt } from '../prompts/previous-turn.prompt.js';
import { buildQuestionRepairPrompt } from '../prompts/question-repair.prompt.js';
import { buildLostSessionTaskPrompt, buildResumedWorkPrompt } from '../prompts/resumed-work.prompt.js';
import {
  buildAgentLanguagePrompt,
  buildCeoLanguagePrompt,
  buildLanguageDetectionPrompt,
  DEFAULT_USER_LANGUAGE,
} from '../prompts/user-language.prompt.js';
import { AgentProtocolService } from '../services/agent-protocol.service.js';
import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';
import {
  type CeoDecision,
  type DelegationResult,
  DelegationDetectorService,
} from '../services/delegation-detector.service.js';
import { OpenWorkService } from '../services/open-work.service.js';
import { QuestionParserService } from '../services/question-parser.service.js';
import { UserQuestionQueueService } from '../services/user-question-queue.service.js';
import { resolveProfile } from '../utils/agent-profile.util.js';
import { escapeTagAttribute } from '../utils/protocol-tag.util.js';
import { extractUserLanguage } from '../utils/user-language.util.js';

import { TranscribeAudioAttachmentsUseCase } from './transcribe-audio-attachments.use-case.js';


const UNSET_LABEL = 'default';
const FILE_URL_PREFIX = 'file://';
const TIMED_OUT_NOTE = '<note>The user was absent and did not reply in time. Answers with status="timed_out" are not the user\'s own: the recommended option was assumed for now, and an answer with no option had no recommendation, so decide how to proceed yourself.</note>';
const LOG_PREVIEW_LENGTH = 100;

type ValidatedDelegation = DelegationResult & {
  readonly cwd: string;
  /** Present on a delegation resumed after a restart, which keeps the id of the one it continues. */
  readonly workId?: string;
  /** What the agent receives first, in place of the task. */
  readonly firstPrompt?: string;
  readonly answerDelivery?: AnswerDelivery;
};

/**
 * Answers on their way to an agent that asked before a restart. The record keeps the questions until the prompt is sent,
 * so a restart before that asks them again; from then on the agent has them and is simply working.
 */
type AnswerDelivery = {
  readonly workId: string;
  readonly questions: OpenWorkQuestions;
  /** The first prompt does not carry the task, which a session created in place of the lost one would not know. */
  readonly taskSpec: string;
};

/** Work a restart interrupted, with the answers when the agent had asked and the user has answered since. */
type Resumption = {
  readonly work: OpenWork;
  readonly answers?: readonly AnsweredQuestion[];
};

type ValidatedDecision =
  | Exclude<CeoDecision, { kind: 'delegate' }>
  | { readonly kind: 'delegate'; readonly message: string; readonly delegations: readonly ValidatedDelegation[] };

type CeoRoundDecision = Exclude<ValidatedDecision, { kind: 'ask' }>;


@Injectable()
export class ExecuteAgentTurnUseCase {
  private readonly logger = new Logger(ExecuteAgentTurnUseCase.name);
  private readonly MAX_DELEGATION_ROUNDS = 1000;
  private readonly MAX_REPAIR_ATTEMPTS = 1;
  private sessionBindings: Promise<void> = Promise.resolve();
  /** The CEO itself replaced these, so how they end is neither a result for it nor a reason to end the turn. */
  private readonly replacedDelegations = new WeakSet<ActiveDelegation>();
  /** A role can pass to another turn's agent while the replaced one closes, so the role alone does not say whose agent it is. */
  private readonly delegationOwners = new WeakMap<ActiveDelegation, RunningDelegations>();

  constructor(
    @Inject(IAgentPortFactory)
    private readonly agentPortFactory: IAgentPortFactory,
    @Inject(ISessionStorePort)
    private readonly sessionStore: ISessionStorePort,
    @Inject(IAgentRegistryPort)
    private readonly agentRegistry: IAgentRegistryPort,
    @Inject(IWorkspacePort)
    private readonly workspacePort: IWorkspacePort,
    @Inject(IAgentSettingsStorePort)
    private readonly settingsStore: IAgentSettingsStorePort,
    @Inject(IPreferencesStorePort)
    private readonly preferencesStore: IPreferencesStorePort,
    private readonly delegationDetector: DelegationDetectorService,
    private readonly conversationRuntime: ConversationRuntimeService,
    private readonly agentProtocol: AgentProtocolService,
    private readonly questionParser: QuestionParserService,
    private readonly questionQueue: UserQuestionQueueService,
    private readonly audioTranscription: TranscribeAudioAttachmentsUseCase,
    private readonly openWork: OpenWorkService,
    @Inject(IFileSystemPort)
    private readonly fileSystem: IFileSystemPort,
  ) {}

  execute(request: TurnRequest): Promise<TurnResult> {
    return runInLogConversation(request.conversationId, () => this.executeTurn(request));
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
    return runInLogConversation(request.conversationId, () => this.executeTurn({ ...request, prompt: '', resumable: true }, resumption));
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
      agentId = await this.resolveRoleAgentId(request.conversationId, request.agentRole);
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
      if (this.isCancellation(error)) {
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
    let prompt = this.enrichPromptWithAttachments(request.prompt, request.attachments);
    const running = new RunningDelegations();
    let lastBlockSignature: string | undefined;
    let delegationRounds = 0;
    const resumedRoot = resumed?.work.root ? resumed : undefined;
    const ceoWorkId = request.resumable ? resumedRoot?.work.id ?? randomUUID() : undefined;
    let ceoAnswerDelivery = resumedRoot && this.answerDeliveryOf(resumedRoot);

    try {
      if (resumed && !resumed.work.root) {
        session = await this.resolveSession(request);
        observers.onSessionResolved(session);
        running.add(this.startDelegations(session, [await this.toResumedDelegation(resumed, request)], request, resumed.work.round, conversationKey, running));
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
        const { response, decision } = await this.conversationRuntime.runOnCeo(
          conversationKey,
          agentId,
          async (ceoPort, turn) => {
            observers.onCeoPort(ceoPort);
            if (!session) {
              session = await this.resolveSession(request);
              observers.onSessionResolved(session);
              this.logger.log(
                `[Turn Started] User=${request.userId}, Conversation=${request.conversationId}, Role=${request.agentRole}`,
              );
            }
            const block = await this.buildTeamProfilesBlock(conversationKey, request);
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
              this.conversationRuntime.addCeoNotice(conversationKey, `${this.describeDelegation(delegateToRole, projectName ?? null, taskSpec)} never started.`);
            }
            return await finish('failed', 'Delegation limit reached.', 'Max delegation rounds exceeded.');
          }
          running.add(this.startDelegations(session!, decision.delegations, request, round, conversationKey, running));
        }
        if (decision.message) {
          request.onInterimMessage?.(decision.message);
        }
        const results = await running.nextResults();
        // Another turn replaced every agent this one was waiting for, and that turn answers the user.
        if (results === undefined) {
          return await finish('steered', '');
        }
        prompt = results;
      }
    } finally {
      await this.stopRunningDelegations(running, conversationKey);
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
      ? this.formatAnswers(await this.transcribeAnswers(request, answers))
      : buildResumedWorkPrompt(work.taskSpec);
  }

  private async steerRunningCeo(
    conversationKey: string,
    agentId: string,
    request: TurnRequest,
  ): Promise<boolean> {
    const prompt = buildCeoSteeringPrompt(this.enrichPromptWithAttachments(request.prompt, request.attachments));
    const reminder = this.agentRegistry.getTurnReminder(request.agentRole);
    const languagePrompt = await this.buildLanguagePrompt(request.agentRole, request.agentRole);
    const block = (await this.buildTeamProfilesBlock(conversationKey, request)).text;
    const steered = await this.conversationRuntime.steerCeo(
      conversationKey,
      agentId,
      [block, prompt, reminder, languagePrompt].filter(Boolean).join('\n\n'),
    );
    if (steered) {
      this.logger.log(
        `[CEO Steered] Conversation=${conversationKey}, User=${request.userId}, Prompt="${this.preview(request.prompt)}"`,
      );
    }
    return steered;
  }

  private async buildSteeredResult(conversationKey: string, request: TurnRequest): Promise<TurnResult> {
    const ceoPort = this.conversationRuntime.getCeoPort(conversationKey)!;
    return {
      response: '',
      status: 'steered',
      agentInfo: await this.buildAgentInfo(ceoPort, request.agentRole, request.conversationId),
    };
  }

  private enrichPromptWithAttachments(
    prompt: string,
    attachments?: readonly TurnAttachment[],
  ): string {
    if (!attachments || attachments.length === 0) {
      return prompt;
    }

    const lines = attachments.map(
      attachment => `- Name: ${attachment.name}\n  Size: ${attachment.size} bytes\n  Type: ${attachment.contentType}\n  Path: ${attachment.path}`,
    );

    return `[ATTACHMENTS]\n${lines.join('\n')}\nInspect these files using your available tools as needed.\n\n${prompt}`;
  }

  private describeDelegation(role: string, projectName: string | null, taskSpec: string): string {
    return `${role} (Project: ${projectName ?? 'none'}, Task: "${taskSpec}")`;
  }

  /** The signature ignores elapsed time, so only a change in a profile, in who is working, their task summary or their wait state resends the block. */
  private async buildTeamProfilesBlock(
    conversationKey: string,
    request: TurnRequest,
  ): Promise<{ readonly text: string; readonly signature: string }> {
    const delegations = this.conversationRuntime.getActiveDelegations(conversationKey);
    const settings = await this.settingsStore.load(request.conversationId);
    const lines: string[] = [];
    const signature: string[] = [];
    for (const role of this.agentRegistry.listRoles()) {
      if (role === request.agentRole) {
        continue;
      }
      const delegation = delegations.find(active => active.role === role);
      const { agentName, modelName, effortName } = delegation?.agentInfo ?? this.describeProfile(settings, role);
      const profile = `Agent: ${agentName}, Model: ${modelName ?? UNSET_LABEL}, Effort: ${effortName ?? UNSET_LABEL}`;
      if (!delegation) {
        lines.push(`- ${role}: ${profile}, Status: idle`);
        signature.push(`${role}\u0000${profile}\u0000idle`);
        continue;
      }
      const waiting = this.questionQueue.isWaiting(conversationKey, role, delegation.projectName) ? 'yes' : 'no';
      const work = `Project: ${delegation.projectName ?? 'none'}, Waiting for user: ${waiting}, Summary: "${delegation.summary}"`;
      lines.push(`- ${role}: ${profile}, Status: working, Running: ${this.formatElapsed(Date.now() - delegation.startedAt)}, ${work}`);
      signature.push(`${role}\u0000${profile}\u0000working\u0000${work}`);
    }
    return { text: `[TEAM_PROFILES]\n${lines.join('\n')}\n`, signature: signature.join('\u0001') };
  }

  private describeProfile(settings: AgentSettings | null, role: string): Omit<TurnAgentInfo, 'roleName'> {
    const profile = settings ? resolveProfile(settings, role) : undefined;
    if (!profile) {
      const { defaultAgentId } = this.agentPortFactory;
      return { agentName: this.agentPortFactory.listAgents().find(agent => agent.agentId === defaultAgentId)?.displayName ?? defaultAgentId };
    }
    return {
      agentName: profile.agentName,
      ...(profile.modelName ? { modelName: profile.modelName } : {}),
      ...(profile.effortName ? { effortName: profile.effortName } : {}),
    };
  }

  private formatElapsed(elapsedMs: number): string {
    const seconds = Math.floor(elapsedMs / 1000);
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
  }

  private async resolveSession(request: TurnRequest): Promise<SessionContext> {
    const existing = await this.sessionStore.findSession(request.conversationId);
    if (existing) {
      return existing;
    }
    const session: SessionContext = { conversationId: request.conversationId, agentSessions: [] };
    await this.sessionStore.saveSession(session);
    return session;
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
  ): Promise<{ response: string; decision: CeoRoundDecision }> {
    const runCeo = async (text: string, isUserText = false, delivery?: AnswerDelivery) => this.takeUserLanguage(await this.runAgentTurn(
      ceoPort,
      request.workspacePath,
      request.agentRole,
      text,
      request,
      turn,
      session,
      'resume',
      undefined,
      isUserText,
      delivery,
    ));

    let response = await runCeo(prompt, isUserMessage, answerDelivery);
    for (;;) {
      let decision = await this.decide(response, request);
      for (let attempt = 1; decision.kind === 'invalid' && attempt <= this.MAX_REPAIR_ATTEMPTS; attempt++) {
        this.logger.warn(
          `[Delegation Repair] Conversation=${session.conversationId}, Attempt=${attempt}: ${decision.reason}`,
        );
        request.onDraft?.('');
        response = await runCeo(buildDelegationRepairPrompt(decision.reason));
        decision = await this.decide(response, request);
      }
      if (decision.kind !== 'ask') {
        return { response, decision };
      }

      const answers = await this.askUser(request, this.buildAsker(request.agentRole, undefined), decision.message, decision.questions, workId);
      response = await runCeo(this.formatAnswers(answers), true);
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

  /** The CEO talks to the user on behalf of the team, so only its prompts carry the language detection. */
  private async buildLanguagePrompt(role: string, ceoRole: string): Promise<string> {
    const { language } = await this.preferencesStore.load();
    if (role !== ceoRole) {
      return buildAgentLanguagePrompt(language ?? DEFAULT_USER_LANGUAGE);
    }
    return language ? buildCeoLanguagePrompt(language) : buildLanguageDetectionPrompt();
  }

  private async decide(response: string, request: TurnRequest): Promise<ValidatedDecision> {
    const decision = this.delegationDetector.detect(response);
    if (decision.kind !== 'delegate') {
      return decision;
    }

    const delegations: ValidatedDelegation[] = [];
    for (const delegation of decision.delegations) {
      const validated = await this.validateDelegation(delegation, request);
      if ('reason' in validated) {
        return { kind: 'invalid', reason: validated.reason };
      }
      delegations.push(validated);
    }

    const conflict = this.findParallelConflict(delegations, request.conversationId);
    return conflict ? { kind: 'invalid', reason: conflict } : { kind: 'delegate', message: decision.message, delegations };
  }

  private async validateDelegation(
    delegation: DelegationResult,
    request: TurnRequest,
  ): Promise<ValidatedDelegation | { readonly reason: string }> {
    const { delegateToRole, projectName } = delegation;
    if (delegateToRole === request.agentRole.toUpperCase() || !this.agentRegistry.hasRole(delegateToRole)) {
      return { reason: `Unknown role "${delegateToRole}". Delegate only to a role listed in Your Team.` };
    }

    const violation = this.checkDelegationContract(
      delegateToRole,
      this.agentRegistry.getDelegationContract(delegateToRole),
      delegation,
    );
    if (violation) {
      return { reason: violation };
    }

    if (!projectName) {
      return { ...delegation, cwd: request.workspacePath };
    }

    let cwd: string;
    try {
      cwd = this.workspacePort.resolveRepositoryPath(projectName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { reason: `Invalid project folder "${projectName}": ${message}. ${this.describeProjectFolders(await this.workspacePort.listProjectFolders())}` };
    }

    const folders = await this.workspacePort.listProjectFolders();
    if (!folders.includes(projectName)) {
      return {
        reason: `Project folder "${projectName}" does not exist in the workspaces root. ${this.describeProjectFolders(folders)}`,
      };
    }

    return { ...delegation, cwd };
  }

  /**
   * A conversation runs one agent per role, so a role appears once per response and a delegation to a role
   * already working replaces that agent. Agents of different roles that modify files would overwrite each
   * other's work in the same folder.
   */
  private findParallelConflict(delegations: readonly ValidatedDelegation[], conversationKey: string): string | undefined {
    const roles = new Set<string>();
    for (const { delegateToRole } of delegations) {
      if (roles.has(delegateToRole)) {
        return `${delegateToRole} appears more than once. A conversation runs one agent per role: merge those tasks into a single delegation.`;
      }
      roles.add(delegateToRole);
    }

    const writers = new Map<string, string>();
    for (const active of this.conversationRuntime.getActiveDelegations(conversationKey)) {
      const redirected = delegations.some(delegation => delegation.delegateToRole === active.role.toUpperCase());
      if (!redirected && !this.isReadOnly(active.role)) {
        writers.set(active.cwd, `${active.role}, which is already working there`);
      }
    }

    for (const { delegateToRole, projectName, cwd } of delegations) {
      if (this.isReadOnly(delegateToRole)) {
        continue;
      }
      const other = writers.get(cwd);
      if (other) {
        return `${delegateToRole} cannot work in ${this.describeTarget(projectName)} at the same time as ${other}: only one agent that modifies files may work in a folder at a time. Run them in sequence, or delegate to that same agent to redirect it.`;
      }
      writers.set(cwd, delegateToRole);
    }
    return undefined;
  }

  private isReadOnly(role: string): boolean {
    return this.agentRegistry.getDelegationContract(role).readOnly === true;
  }

  private describeTarget(projectName: string | undefined): string {
    return projectName ? `project folder "${projectName}"` : 'the workspaces root';
  }

  private describeProjectFolders(folders: readonly string[]): string {
    return folders.length > 0
      ? `Use one of the existing project folders exactly as written: ${folders.join(', ')}.`
      : 'The workspaces root has no project folders yet; add the repository first, delegating without a project folder.';
  }

  // TODO: find a more generic way to validate delegation parameters, perhaps a zod schema per agent.
  private checkDelegationContract(
    role: string,
    contract: DelegationContract,
    { projectName, sessionMode }: DelegationResult,
  ): string | undefined {
    if (projectName && !contract.project) {
      return `Role "${role}" does not take a project folder. Use <delegate role="${role}" summary="<summary>"> without the project attribute.`;
    }
    if (!projectName && contract.project === 'required') {
      return `Role "${role}" requires a project folder. Use <delegate role="${role}" summary="<summary>" project="<project-folder>">.`;
    }
    if (sessionMode && !contract.sessionMode) {
      return `Role "${role}" does not take a session mode. Use <delegate role="${role}" summary="<summary>"> without the session attribute.`;
    }
    return undefined;
  }

  /**
   * A failed delegation becomes a result for the CEO, so the work of the others still reaches it; a cancellation
   * ends the turn.
   */
  private startDelegations(
    session: SessionContext,
    delegations: readonly ValidatedDelegation[],
    request: TurnRequest,
    round: number,
    conversationKey: string,
    running: RunningDelegations,
  ): readonly StartedDelegation[] {
    return delegations.map(delegation => ({
      role: delegation.delegateToRole,
      outcome: this.delegate(session, delegation, request, round, conversationKey, running).then(
        (block): DelegationOutcome => (block === undefined ? { kind: 'replaced' } : { kind: 'result', block }),
        (error): DelegationOutcome => {
          if (this.isCancellation(error)) {
            return { kind: 'cancelled', reason: error };
          }
          const { delegateToRole, projectName } = delegation;
          return { kind: 'result', block: this.formatFailedResult(session, round, delegateToRole, projectName, error) };
        },
      ),
    }));
  }

  /**
   * A turn that ends with delegations still running (CEO failure, invalid response, cancellation) stops them, so no
   * agent runs unobserved. Discarding the questions of an agent waiting for the user is what releases it: its wait
   * would otherwise hold the turn open until the user answered a question nobody would receive.
   */
  private async stopRunningDelegations(running: RunningDelegations, conversationKey: string): Promise<void> {
    const stopping = running.pendingRoles
      .map(role => this.conversationRuntime.findActiveDelegation(conversationKey, role))
      .filter(delegation => delegation !== undefined)
      .filter(delegation => this.delegationOwners.get(delegation) === running);
    await Promise.allSettled(
      stopping.map((delegation) => {
        this.questionQueue.discard(conversationKey, delegation.role, delegation.projectName);
        return delegation.turn.cancel();
      }),
    );
    await running.settled();
  }

  private async answerQuestions(
    firstResponse: string,
    runAgent: (text: string) => Promise<string>,
    asker: QuestionAsker,
    request: TurnRequest,
    workId: string | undefined,
  ): Promise<string> {
    let response = firstResponse;
    let repairs = 0;
    for (;;) {
      const parsed = this.questionParser.parse(response);
      if (parsed.kind === 'none') {
        return response;
      }
      if (parsed.kind === 'invalid') {
        if (repairs === this.MAX_REPAIR_ATTEMPTS) {
          return response;
        }
        repairs++;
        this.logger.warn(`[Question Repair] Role=${asker.role}, Attempt=${repairs}: ${parsed.reason}`);
        response = await runAgent(buildQuestionRepairPrompt(parsed.reason));
        continue;
      }
      repairs = 0;
      const answers = await this.askUser(request, asker, parsed.message, parsed.questions, workId);
      response = await runAgent(this.formatAnswers(answers));
    }
  }

  private async askUser(
    request: TurnRequest,
    asker: QuestionAsker,
    message: string,
    questions: readonly UserQuestion[],
    workId: string | undefined,
  ): Promise<readonly AnsweredQuestion[]> {
    this.logger.log(`[Questions Asked] Conversation=${request.conversationId}, Role=${asker.role}, Questions=${questions.length}`);
    const { conversationId } = request;
    if (workId) {
      await this.openWork.update(conversationId, workId, { questions: { message, questions, answers: [] } });
    }
    const answers = await this.questionQueue.ask(
      conversationId,
      asker,
      message,
      questions,
      {
        asked: prompt => request.onQuestion?.({ kind: 'asked', prompt }),
        timedOut: event => request.onQuestion?.({ kind: 'timedOut', ...event }),
        ...(workId && {
          answersChanged: (answered: readonly AnsweredQuestion[]) =>
            void this.openWork.update(conversationId, workId, { questions: { message, questions, answers: answered } }),
        }),
      },
    );
    if (workId) {
      await this.openWork.update(conversationId, workId, { questions: undefined });
    }
    return this.transcribeAnswers(request, answers);
  }

  /** An answer spoken as audio reaches the asking agent as text, like a spoken message does. */
  private async transcribeAnswers(
    request: TurnRequest,
    answers: readonly AnsweredQuestion[],
  ): Promise<readonly AnsweredQuestion[]> {
    const transcripts: AudioTranscript[] = [];
    const warnings: string[] = [];
    const transcribed: AnsweredQuestion[] = [];
    for (const { attachments, ...answered } of answers) {
      const result = await this.audioTranscription.execute({ prompt: answered.answer, attachments });
      transcripts.push(...result.transcripts);
      warnings.push(...result.warnings);
      transcribed.push({
        ...answered,
        answer: result.prompt,
        ...(result.attachments.length > 0 && { attachments: result.attachments }),
      });
    }
    if (transcripts.length > 0 || warnings.length > 0) {
      request.onTranscription?.({ transcripts, warnings });
    }
    return transcribed;
  }

  private buildAsker(role: string, projectName: string | undefined): QuestionAsker {
    return { role, roleName: this.agentRegistry.getDisplayName(role), projectName: projectName ?? null };
  }

  /** Repeats each question, because the agent's context may have been compacted while the user answered. */
  private formatAnswers(answers: readonly AnsweredQuestion[]): string {
    const lines = answers.map(({ question, answer, optionNumber, timedOut, attachments = [] }) => {
      const choice = [
        optionNumber === undefined ? (timedOut ? '' : 'kind="other"') : `option="${optionNumber}"`,
        timedOut ? 'status="timed_out"' : '',
      ].filter(Boolean).join(' ');
      const files = attachments.map(file => `\n<attachment path="${escapeTagAttribute(file.path)}" name="${escapeTagAttribute(file.name)}" type="${escapeTagAttribute(file.contentType)}"/>`);
      return `<answer question="${escapeTagAttribute(question.text)}" ${choice}>${answer}${files.join('')}</answer>`;
    });
    const note = answers.some(({ timedOut }) => timedOut) ? [TIMED_OUT_NOTE] : [];
    return ['<user_answers>', ...lines, ...note, '</user_answers>'].join('\n');
  }

  private formatAgentResult(
    role: string,
    projectName: string | undefined,
    body: string,
    options: { readonly status?: 'failed'; readonly agentInfo?: TurnAgentInfo } = {},
  ): string {
    const project = projectName ? ` project="${projectName}"` : '';
    const { agentInfo } = options;
    const config = agentInfo
      ? ` agent="${escapeTagAttribute(agentInfo.agentName)}" model="${escapeTagAttribute(agentInfo.modelName ?? UNSET_LABEL)}" effort="${escapeTagAttribute(agentInfo.effortName ?? UNSET_LABEL)}"`
      : '';
    const failed = options.status ? ` status="${options.status}"` : '';
    return `<agent_result role="${role}"${project}${config}${failed}>\n${body}\n</agent_result>`;
  }

  private formatFailedResult(
    session: SessionContext,
    round: number,
    delegateToRole: string,
    projectName: string | undefined,
    error: unknown,
    agentInfo?: TurnAgentInfo,
  ): string {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`[Delegation Failed] Conversation=${session.conversationId}, Round=${round}, Role=${delegateToRole}: ${message}`);
    return this.formatAgentResult(delegateToRole, projectName, message, { status: 'failed', agentInfo });
  }

  private isCancellation(error: unknown): boolean {
    return error instanceof PromptCancelledError
      || (error instanceof Error && error.name === 'PromptCancelledError');
  }

  private async delegate(
    session: SessionContext,
    { delegateToRole, projectName, taskSpec, summary, sessionMode, cwd, workId, firstPrompt, answerDelivery }: ValidatedDelegation,
    request: TurnRequest,
    round: number,
    conversationKey: string,
    running: RunningDelegations,
  ): Promise<string | undefined> {
    const existing = this.conversationRuntime.findActiveDelegation(conversationKey, delegateToRole);
    if (existing) {
      const sameProject = existing.projectName === (projectName ?? null);
      const awaitingAnswers = this.questionQueue.isWaiting(conversationKey, delegateToRole, existing.projectName);
      if (sameProject && !awaitingAnswers && existing.agentPort.supportsSteering && await existing.steer(taskSpec)) {
        this.logger.log(
          `[Delegation Steered] Role=${delegateToRole}, NewTask="${this.preview(taskSpec)}"`,
        );
        return this.formatAgentResult(delegateToRole, projectName, 'Steering message sent to active agent.', { agentInfo: existing.agentInfo });
      }

      this.logger.log(
        `[Delegation Restarted] Role=${delegateToRole}, Cancelling and recreating agent process (steering unavailable or project changed)`,
      );
      this.replacedDelegations.add(existing);
      this.questionQueue.discard(conversationKey, delegateToRole, existing.projectName);
      await existing.turn.cancel();
      await existing.agentPort.closeSession().catch(() => undefined);
      await existing.agentPort.disconnect().catch(() => undefined);
      this.conversationRuntime.unregisterDelegation(conversationKey, existing);
    }

    await this.replaceInterruptedWork(conversationKey, delegateToRole, workId);

    const delegatePort = this.agentPortFactory.create(
      await this.resolveRoleAgentId(request.conversationId, delegateToRole),
    );
    const agentInfo = await this.buildAgentInfo(delegatePort, delegateToRole, request.conversationId);
    const event = {
      delegationId: workId ?? randomUUID(),
      round,
      role: delegateToRole,
      roleName: this.agentRegistry.getDisplayName(delegateToRole),
      projectName,
      summary,
      taskSpec,
    };
    const startedAt = Date.now();

    this.logger.log(
      `[Delegation Started] Conversation=${session.conversationId}, Round=${round}, Role=${delegateToRole} (${event.roleName}), Project=${projectName ?? 'none'}, Cwd=${cwd}, Task="${this.preview(taskSpec)}"`,
    );
    request.onDelegation?.({ ...event, phase: 'started' });

    const effectiveSessionMode = sessionMode ?? this.agentRegistry.getDefaultSessionMode(delegateToRole);
    let currentTaskSpec = taskSpec;
    const openWorkId = request.resumable ? event.delegationId : undefined;

    const delegationTurn = new ActiveTurn(delegatePort);
    const activeDelegation: ActiveDelegation = {
      role: delegateToRole,
      roleName: event.roleName,
      agentInfo,
      projectName: projectName ?? null,
      summary,
      get taskSpec() {
        return currentTaskSpec;
      },
      cwd,
      startedAt,
      agentPort: delegatePort,
      turn: delegationTurn,
      steer: async (newSpec: string) => {
        currentTaskSpec = newSpec;
        if (openWorkId) {
          await this.openWork.update(conversationKey, openWorkId, { taskSpec: newSpec });
        }
        const languagePrompt = await this.buildLanguagePrompt(delegateToRole, request.agentRole);
        return delegatePort.supportsSteering && delegatePort.sendSteeringPrompt(`${newSpec}\n\n${languagePrompt}`);
      },
    };

    this.delegationOwners.set(activeDelegation, running);
    this.conversationRuntime.registerDelegation(conversationKey, activeDelegation);
    if (openWorkId) {
      await this.openWork.open(conversationKey, {
        id: openWorkId,
        role: delegateToRole,
        roleName: event.roleName,
        projectName: projectName ?? null,
        summary,
        taskSpec,
        cwd,
        round,
        root: false,
        ...(answerDelivery ? { questions: answerDelivery.questions } : {}),
      });
    }

    try {
      const runDelegate = (text: string, delivery?: AnswerDelivery) => this.runAgentTurn(
        delegatePort,
        cwd,
        delegateToRole,
        text,
        request,
        delegationTurn,
        session,
        effectiveSessionMode,
        projectName,
        false,
        delivery,
      );
      const response = await this.answerQuestions(
        await runDelegate(firstPrompt ?? currentTaskSpec, answerDelivery),
        text => runDelegate(text),
        this.buildAsker(delegateToRole, projectName),
        request,
        openWorkId,
      );
      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `[Delegation Finished] Conversation=${session.conversationId}, Round=${round}, Role=${delegateToRole}, Duration=${(durationMs / 1000).toFixed(1)}s, ResponseLength=${response.length}`,
      );
      request.onDelegation?.({
        ...event,
        phase: 'finished',
        response,
        agentInfo: await this.buildAgentInfo(delegatePort, delegateToRole, request.conversationId),
        usage: await delegatePort.getLastRoundUsage().catch(() => undefined),
        durationMs,
      });
      return this.formatAgentResult(delegateToRole, projectName, response, { agentInfo });
    } catch (error) {
      // Closing a replaced agent's session can surface as any error, none of which is a failure of its task.
      if (this.replacedDelegations.has(activeDelegation)) {
        request.onDelegation?.({ ...event, phase: 'cancelled', durationMs: Date.now() - startedAt });
        return undefined;
      }
      if (this.isCancellation(error)) {
        request.onDelegation?.({ ...event, phase: 'cancelled', durationMs: Date.now() - startedAt });
        this.conversationRuntime.addCeoNotice(conversationKey, `${this.describeDelegation(delegateToRole, activeDelegation.projectName, currentTaskSpec)} was stopped before finishing.`);
        throw error;
      }
      request.onDelegation?.({
        ...event,
        phase: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
      return this.formatFailedResult(session, round, delegateToRole, projectName, error, agentInfo);
    } finally {
      if (openWorkId) {
        await this.openWork.close(conversationKey, openWorkId);
      }
      this.conversationRuntime.unregisterDelegation(conversationKey, activeDelegation);
      await delegatePort.closeSession().catch(() => undefined);
      await delegatePort.disconnect().catch(() => undefined);
    }
  }

  /** A new delegation of a role takes the place of whatever a restart left stopped for it. */
  private async replaceInterruptedWork(conversationKey: string, role: string, keptWorkId: string | undefined): Promise<void> {
    for (const work of this.openWork.interrupted(conversationKey)) {
      if (work.role === role && work.id !== keptWorkId) {
        this.questionQueue.discard(conversationKey, role, work.projectName);
        await this.openWork.close(conversationKey, work.id);
      }
    }
  }

  private async runAgentTurn(
    agentPort: IAgentPort,
    workspacePath: string,
    role: string,
    prompt: string,
    request: TurnRequest,
    turn: ActiveTurn,
    session: SessionContext,
    sessionMode: 'resume' | 'new' = 'resume',
    projectName?: string,
    isUserMessage = false,
    answerDelivery?: AnswerDelivery,
  ): Promise<string> {
    let unsubscribeActivity: (() => void) | undefined;
    let accumulatedChunks = '';

    turn.activate(agentPort);

    try {
      turn.throwIfCancelled();
      await agentPort.connect();
      turn.throwIfCancelled();

      const reminder = this.agentRegistry.getTurnReminder(role);
      const languagePrompt = await this.buildLanguagePrompt(role, request.agentRole);
      const plansPrompt = this.agentRegistry.usesPlansDirectory(role)
        ? buildPlansDirectoryPrompt(join(this.workspacePort.getBaseDirectory(), PLANS_DIRECTORY_NAME, projectName ?? PLANS_NO_PROJECT_FOLDER))
        : undefined;
      let fullPrompt = [prompt, reminder, languagePrompt, plansPrompt].filter(Boolean).join('\n\n');
      let systemPromptPending = isUserMessage && this.agentRegistry.isSystemPromptEveryTurn(role);
      if (!agentPort.currentSessionId) {
        const latest = await this.findLatestSession(session);
        const storedSessionId = sessionMode === 'new'
          ? undefined
          : latest.agentSessions.find(agentSession =>
            this.isSameAgentSession(agentSession, { role, agentId: agentPort.agentName, projectName: projectName ?? null }))?.sessionId;
        const resumed = await this.resumeAgentSession(agentPort, workspacePath, storedSessionId);
        if (!resumed) {
          await this.workspacePort.ensureDirectory(workspacePath);
          await agentPort.createSession(workspacePath);
          systemPromptPending = true;
          if (answerDelivery) {
            fullPrompt = `${buildLostSessionTaskPrompt(answerDelivery.taskSpec)}\n\n${fullPrompt}`;
          }
        }
        const { currentSessionId } = agentPort;
        if (currentSessionId && currentSessionId !== storedSessionId) {
          await this.bindAgentSession(latest, {
            role,
            agentId: agentPort.agentName,
            sessionId: currentSessionId,
            projectName: projectName ?? null,
          });
        }
      }

      if (systemPromptPending) {
        fullPrompt = `${this.agentRegistry.getSystemPrompt(role)}\n\n${fullPrompt}`;
      }

      await this.applyAgentConfig(agentPort, role, request.conversationId);

      const stream = this.agentProtocol.stream({
        onActivity: activity => request.onActivity?.(activity, role),
        // Only the CEO talks to the user, so the answers other agents write stay out of the draft.
        ...(role === request.agentRole && { onAnswer: answer => request.onDraft?.(this.agentProtocol.visibleReply(answer)) }),
      });
      unsubscribeActivity = agentPort.onActivity(activity => stream.read(activity));

      turn.throwIfCancelled();
      if (answerDelivery) {
        await this.openWork.update(request.conversationId, answerDelivery.workId, { questions: undefined });
      }
      for await (const update of agentPort.prompt(fullPrompt)) {
        accumulatedChunks += update.text;
      }

      const response = this.agentProtocol.finalResponse(agentPort.lastAgentMessage || accumulatedChunks);
      this.logger.log(`[Agent Response] Role=${role}, Length=${response.length}: "${this.preview(response)}"`);
      return response;
    } finally {
      unsubscribeActivity?.();
    }
  }

  private preview(text: string): string {
    const singleLine = text.replace(/\s+/g, ' ').trim();
    return singleLine.length > LOG_PREVIEW_LENGTH ? `${singleLine.slice(0, LOG_PREVIEW_LENGTH)}...` : singleLine;
  }

  private async resumeAgentSession(
    agentPort: IAgentPort,
    workspacePath: string,
    sessionId: string | undefined,
  ): Promise<boolean> {
    if (!sessionId) {
      return false;
    }
    const loaded = await agentPort.loadSession(workspacePath, sessionId);
    this.logger.log(
      `[Agent Session ${loaded ? 'Resumed' : 'Not Resumed'}] AgentSession=${sessionId}`,
    );
    return loaded;
  }

  private async findLatestSession(session: SessionContext): Promise<SessionContext> {
    return await this.sessionStore.findSession(session.conversationId) ?? session;
  }

  /** Parallel delegations bind their sessions concurrently, so each binding re-reads the stored session in sequence. */
  private async bindAgentSession(session: SessionContext, binding: AgentSession): Promise<void> {
    const bound = this.sessionBindings.then(async () => {
      const latest = await this.findLatestSession(session);
      const others = latest.agentSessions.filter(agentSession => !this.isSameAgentSession(agentSession, binding));
      await this.sessionStore.saveSession({
        ...latest,
        agentSessions: [...others, binding],
      });
    });
    this.sessionBindings = bound.catch(() => undefined);
    await bound;
  }

  private isSameAgentSession(
    agentSession: AgentSession,
    target: Pick<AgentSession, 'role' | 'agentId' | 'projectName'>,
  ): boolean {
    return agentSession.role === target.role
      && agentSession.agentId === target.agentId
      && agentSession.projectName === target.projectName;
  }

  private async applyAgentConfig(agentPort: IAgentPort, role: string, conversationId: string): Promise<void> {
    const profile = await this.findAgentProfile(agentPort, role, conversationId);
    if (profile?.modelId) {
      await agentPort.setConfig({
        modelId: profile.modelId,
        effortId: profile.effortId ?? undefined,
      });
      return;
    }

    const defaultModel = this.agentRegistry.getDefaultModel(role);
    if (defaultModel) {
      await agentPort.setConfig({ modelId: defaultModel });
    }
  }

  /** Settings saved for another agent carry model ids that this agent does not know. */
  private async findAgentProfile(
    agentPort: IAgentPort,
    role: string,
    conversationId: string,
  ): Promise<AgentProfileSettings | undefined> {
    const profile = await this.findProfile(conversationId, role);
    return profile?.agentId === agentPort.agentName ? profile : undefined;
  }

  /** Read at every turn and delegation start, so a saved change applies to the next one without interrupting any. */
  private async resolveRoleAgentId(conversationId: string, role: string): Promise<string> {
    return (await this.findProfile(conversationId, role))?.agentId ?? this.agentPortFactory.defaultAgentId;
  }

  private async findProfile(conversationId: string, role: string): Promise<AgentProfileSettings | undefined> {
    const settings = await this.settingsStore.load(conversationId);
    return settings ? resolveProfile(settings, role) : undefined;
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
        ? await this.buildAgentInfo(input.ceoPort, input.role, input.conversationId)
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

  private async buildAgentInfo(agentPort: IAgentPort, role: string, conversationId: string): Promise<TurnAgentInfo> {
    const profile = await this.findAgentProfile(agentPort, role, conversationId);
    return {
      roleName: this.agentRegistry.getDisplayName(role),
      agentName: agentPort.agentName,
      modelName: profile?.modelName ?? this.currentModelName(agentPort),
      effortName: profile?.effortName ?? undefined,
    };
  }

  private currentModelName(agentPort: IAgentPort): string | undefined {
    const state = agentPort.getAvailableModels();
    return state?.availableModels.find(model => model.modelId === state.currentModelId)?.displayName;
  }
}
