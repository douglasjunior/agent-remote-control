import { Inject, Injectable, Logger } from '@nestjs/common';

import { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import {
  type AgentUpdate,
  PromptCancelledError,
  IAgentPort,
} from '../../agent/ports/agent.port.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import type { ActiveDelegation } from '../models/active-delegation.model.js';
import { ActiveTurn } from '../models/active-turn.model.js';
import type { AgentSession } from '../models/agent-session.model.js';
import type { AgentProfileSettings } from '../models/agent-settings.model.js';
import { type DelegationOutcome, RunningDelegations, type StartedDelegation } from '../models/running-delegations.model.js';
import type { SessionContext } from '../models/session-context.model.js';
import type { TurnAgentInfo } from '../models/turn-agent-info.model.js';
import type { TurnAttachment } from '../models/turn-attachment.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult, TurnStatus } from '../models/turn-result.model.js';
import type { AnsweredQuestion, QuestionAsker, UserQuestion } from '../models/user-question.model.js';
import {
  type DelegationContract,
  IAgentRegistryPort,
} from '../ports/agent-registry.port.js';
import { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';
import { IPreferencesStorePort } from '../ports/preferences-store.port.js';
import { ISessionStorePort } from '../ports/session-store.port.js';
import { buildCeoSteeringPrompt } from '../prompts/ceo-steering.prompt.js';
import { buildDelegationRepairPrompt } from '../prompts/delegation-repair.prompt.js';
import { buildQuestionRepairPrompt } from '../prompts/question-repair.prompt.js';
import {
  buildAgentLanguagePrompt,
  buildCeoLanguagePrompt,
  buildLanguageDetectionPrompt,
  DEFAULT_USER_LANGUAGE,
} from '../prompts/user-language.prompt.js';
import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';
import {
  type CeoDecision,
  type DelegationResult,
  DelegationDetectorService,
} from '../services/delegation-detector.service.js';
import { QuestionParserService } from '../services/question-parser.service.js';
import { UserQuestionQueueService } from '../services/user-question-queue.service.js';
import { resolveProfile } from '../utils/agent-profile.util.js';
import { resolveAttachmentPaths } from '../utils/attachment-path.util.js';
import { escapeTagAttribute } from '../utils/protocol-tag.util.js';
import { extractUserLanguage } from '../utils/user-language.util.js';


const LOG_PREVIEW_LENGTH = 100;

type ValidatedDelegation = DelegationResult & { readonly cwd: string };

type ValidatedDecision =
  | Exclude<CeoDecision, { kind: 'delegate' }>
  | { readonly kind: 'delegate'; readonly message: string; readonly delegations: readonly ValidatedDelegation[] };

type CeoRoundDecision = Exclude<ValidatedDecision, { kind: 'ask' }>;


@Injectable()
export class ExecuteAgentTurnUseCase {
  private readonly logger = new Logger(ExecuteAgentTurnUseCase.name);
  private readonly MAX_DELEGATION_ROUNDS = 10;
  private readonly MAX_REPAIR_ATTEMPTS = 1;
  private sessionBindings: Promise<void> = Promise.resolve();

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
    private readonly questionParser: QuestionParserService,
    private readonly questionQueue: UserQuestionQueueService,
  ) {}

  async execute(request: TurnRequest): Promise<TurnResult> {
    const conversationKey = request.conversationId;
    const endTurn = this.conversationRuntime.beginTurn(conversationKey);
    try {
      return await this.runTurn(conversationKey, request);
    } finally {
      endTurn();
    }
  }

  private async runTurn(
    conversationKey: string,
    request: TurnRequest,
  ): Promise<TurnResult> {
    let session: SessionContext | undefined;
    let ceoPort: IAgentPort | undefined;
    let agentId: string | undefined;
    const currentCeoPort = () => ceoPort ?? this.conversationRuntime.getCeoPort(conversationKey);
    const finish = (status: TurnStatus, response: string, errorMessage?: string, attachments: readonly string[] = []) =>
      this.buildResult({
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

    try {
      agentId = await this.resolveRoleAgentId(request.conversationId, request.agentRole);
      if (await this.steerRunningCeo(conversationKey, agentId, request)) {
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
      );
    } catch (error) {
      const conversationLabel = session?.conversationId ?? 'none';
      if (this.isCancellation(error)) {
        this.logger.warn(`[Turn Cancelled] Active turn was cancelled for conversation=${conversationLabel}`);
        return finish('cancelled', currentCeoPort()?.lastAgentMessage ?? '');
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[Turn Failed] Conversation=${conversationLabel}: ${errorMessage}`);

      return finish('failed', currentCeoPort()?.lastAgentMessage ?? '', errorMessage);
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
  ): Promise<TurnResult> {
    let session: SessionContext | undefined;
    let prompt = this.enrichPromptWithAttachments(request.prompt, request.attachments);
    const running = new RunningDelegations();
    let lastBlockSignature: string | undefined;
    let delegationRounds = 0;

    try {
      for (let round = 1; ; round++) {
        const { response, decision } = await this.conversationRuntime.runOnCeo(
          conversationKey,
          agentId,
          async (ceoPort, turn) => {
            observers.onCeoPort(ceoPort);
            const firstRound = !session;
            if (!session) {
              session = await this.resolveSession(request);
              observers.onSessionResolved(session);
              this.logger.log(
                `[Turn Started] User=${request.userId}, Conversation=${request.conversationId}, Role=${request.agentRole}`,
              );
            }
            const block = this.buildActiveDelegationsBlock(conversationKey);
            if (block && (firstRound || block.signature !== lastBlockSignature)) {
              prompt = `${block.text}\n${prompt}`;
            }
            lastBlockSignature = block?.signature;
            return this.runCeoTurn(ceoPort, prompt, request, turn, session, round === 1);
          },
          round === 1 ? request.onQueued : undefined,
        );

        if (decision.kind === 'invalid') {
          return await finish('failed', response, `Invalid CEO response: ${decision.reason}`);
        }

        if (decision.kind === 'reply' && running.isEmpty) {
          return await finish('completed', decision.message, undefined, decision.attachments);
        }

        if (decision.kind === 'delegate') {
          if (++delegationRounds >= this.MAX_DELEGATION_ROUNDS) {
            return await finish('failed', 'Delegation limit reached.', 'Max delegation rounds exceeded.');
          }
          running.add(this.startDelegations(session!, decision.delegations, request, round, conversationKey));
        }
        if (decision.message) {
          request.onInterimMessage?.(decision.message);
        }
        prompt = await running.nextResults();
      }
    } finally {
      await this.stopRunningDelegations(running, conversationKey);
    }
  }

  private async steerRunningCeo(
    conversationKey: string,
    agentId: string,
    request: TurnRequest,
  ): Promise<boolean> {
    const prompt = buildCeoSteeringPrompt(this.enrichPromptWithAttachments(request.prompt, request.attachments));
    const reminder = this.agentRegistry.getTurnReminder(request.agentRole);
    const languagePrompt = await this.buildLanguagePrompt(request.agentRole, request.agentRole);
    const block = this.buildActiveDelegationsBlock(conversationKey)?.text;
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

  /** The signature ignores elapsed time, so only a change in who runs, what they were asked or their wait state resends the block. */
  private buildActiveDelegationsBlock(conversationKey: string): { readonly text: string; readonly signature: string } | undefined {
    const delegations = this.conversationRuntime.getActiveDelegations(conversationKey);
    if (delegations.length === 0) {
      return undefined;
    }
    const lines: string[] = [];
    const signature: string[] = [];
    for (const { role, projectName, taskSpec, startedAt } of delegations) {
      const waiting = this.questionQueue.isWaiting(conversationKey, role, projectName) ? 'yes' : 'no';
      const project = projectName ?? 'none';
      lines.push(`- Role: ${role}, Project: ${project}, Running: ${this.formatElapsed(Date.now() - startedAt)}, Waiting for user: ${waiting}, Task: "${taskSpec}"`);
      signature.push(`${role}\u0000${project}\u0000${waiting}\u0000${taskSpec}`);
    }
    return { text: `[ACTIVE_DELEGATIONS]\n${lines.join('\n')}\n`, signature: signature.join('\u0001') };
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
  ): Promise<{ response: string; decision: CeoRoundDecision }> {
    const runCeo = async (text: string, isUserText = false) => this.takeUserLanguage(await this.runAgentTurn(
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
    ));

    let response = await runCeo(prompt, isUserMessage);
    for (;;) {
      let decision = await this.decide(response, request);
      for (let attempt = 1; decision.kind === 'invalid' && attempt <= this.MAX_REPAIR_ATTEMPTS; attempt++) {
        this.logger.warn(
          `[Delegation Repair] Conversation=${session.conversationId}, Attempt=${attempt}: ${decision.reason}`,
        );
        response = await runCeo(buildDelegationRepairPrompt(decision.reason));
        decision = await this.decide(response, request);
      }
      if (decision.kind !== 'ask') {
        return { response, decision };
      }

      const answers = await this.askUser(request, this.buildAsker(request.agentRole, undefined), decision.message, decision.questions);
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
      return `Role "${role}" does not take a project folder. Use <delegate role="${role}"> without the project attribute.`;
    }
    if (!projectName && contract.project === 'required') {
      return `Role "${role}" requires a project folder. Use <delegate role="${role}" project="<project-folder>">.`;
    }
    if (sessionMode && !contract.sessionMode) {
      return `Role "${role}" does not take a session mode. Use <delegate role="${role}"> without the session attribute.`;
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
  ): readonly StartedDelegation[] {
    return delegations.map(delegation => ({
      role: delegation.delegateToRole,
      outcome: this.delegate(session, delegation, request, round, conversationKey).then(
        (block): DelegationOutcome => ({ kind: 'result', block }),
        (error): DelegationOutcome => {
          if (this.isCancellation(error)) {
            return { kind: 'cancelled', reason: error };
          }
          const { delegateToRole, projectName } = delegation;
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(`[Delegation Failed] Conversation=${session.conversationId}, Round=${round}, Role=${delegateToRole}: ${message}`);
          return { kind: 'result', block: this.formatAgentResult(delegateToRole, projectName, message, 'failed') };
        },
      ),
    }));
  }

  /** A turn that ends with delegations still running (CEO failure, invalid response, cancellation) stops them, so no agent runs unobserved. */
  private async stopRunningDelegations(running: RunningDelegations, conversationKey: string): Promise<void> {
    await Promise.allSettled(
      running.pendingRoles.map(role => this.conversationRuntime.findActiveDelegation(conversationKey, role)?.turn.cancel()),
    );
    await running.settled();
  }

  private async answerQuestions(
    firstResponse: string,
    runAgent: (text: string) => Promise<string>,
    asker: QuestionAsker,
    request: TurnRequest,
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
      const answers = await this.askUser(request, asker, parsed.message, parsed.questions);
      response = await runAgent(this.formatAnswers(answers));
    }
  }

  private askUser(
    request: TurnRequest,
    asker: QuestionAsker,
    message: string,
    questions: readonly UserQuestion[],
  ): Promise<readonly AnsweredQuestion[]> {
    this.logger.log(`[Questions Asked] Conversation=${request.conversationId}, Role=${asker.role}, Questions=${questions.length}`);
    return this.questionQueue.ask(request.conversationId, asker, message, questions, request.onQuestion);
  }

  private buildAsker(role: string, projectName: string | undefined): QuestionAsker {
    return { role, roleName: this.agentRegistry.getDisplayName(role), projectName: projectName ?? null };
  }

  /** Repeats each question, because the agent's context may have been compacted while the user answered. */
  private formatAnswers(answers: readonly AnsweredQuestion[]): string {
    const lines = answers.map(({ question, answer, optionNumber, attachments = [] }) => {
      const choice = optionNumber === undefined ? 'kind="other"' : `option="${optionNumber}"`;
      const files = attachments.map(file => `\n<attachment path="${escapeTagAttribute(file.path)}" name="${escapeTagAttribute(file.name)}" type="${escapeTagAttribute(file.contentType)}"/>`);
      return `<answer question="${escapeTagAttribute(question.text)}" ${choice}>${answer}${files.join('')}</answer>`;
    });
    return ['<user_answers>', ...lines, '</user_answers>'].join('\n');
  }

  private formatAgentResult(role: string, projectName: string | undefined, body: string, status?: 'failed'): string {
    const project = projectName ? ` project="${projectName}"` : '';
    const failed = status ? ` status="${status}"` : '';
    return `<agent_result role="${role}"${project}${failed}>\n${body}\n</agent_result>`;
  }

  private isCancellation(error: unknown): boolean {
    return error instanceof PromptCancelledError
      || (error instanceof Error && error.name === 'PromptCancelledError');
  }

  private async delegate(
    session: SessionContext,
    { delegateToRole, projectName, taskSpec, sessionMode, cwd }: ValidatedDelegation,
    request: TurnRequest,
    round: number,
    conversationKey: string,
  ): Promise<string> {
    const existing = this.conversationRuntime.findActiveDelegation(conversationKey, delegateToRole);
    if (existing) {
      const sameProject = existing.projectName === (projectName ?? null);
      const awaitingAnswers = this.questionQueue.isWaiting(conversationKey, delegateToRole, existing.projectName);
      if (sameProject && !awaitingAnswers && existing.agentPort.supportsSteering && await existing.steer(taskSpec)) {
        this.logger.log(
          `[Delegation Steered] Role=${delegateToRole}, NewTask="${this.preview(taskSpec)}"`,
        );
        return this.formatAgentResult(delegateToRole, projectName, 'Steering message sent to active agent.');
      }

      this.logger.log(
        `[Delegation Restarted] Role=${delegateToRole}, Cancelling and recreating agent process (steering unavailable or project changed)`,
      );
      this.questionQueue.discard(conversationKey, delegateToRole, existing.projectName);
      await existing.turn.cancel();
      await existing.agentPort.closeSession().catch(() => undefined);
      await existing.agentPort.disconnect().catch(() => undefined);
      this.conversationRuntime.unregisterDelegation(conversationKey, existing);
    }

    const delegatePort = this.agentPortFactory.create(
      await this.resolveRoleAgentId(request.conversationId, delegateToRole),
    );
    const event = {
      round,
      role: delegateToRole,
      roleName: this.agentRegistry.getDisplayName(delegateToRole),
      projectName,
    };
    const startedAt = Date.now();

    this.logger.log(
      `[Delegation Started] Conversation=${session.conversationId}, Round=${round}, Role=${delegateToRole} (${event.roleName}), Project=${projectName ?? 'none'}, Cwd=${cwd}, Task="${this.preview(taskSpec)}"`,
    );
    request.onDelegation?.({ ...event, phase: 'started' });

    const effectiveSessionMode = sessionMode ?? this.agentRegistry.getDefaultSessionMode(delegateToRole);
    let currentTaskSpec = taskSpec;

    const delegationTurn = new ActiveTurn(delegatePort);
    const activeDelegation: ActiveDelegation = {
      role: delegateToRole,
      roleName: event.roleName,
      projectName: projectName ?? null,
      get taskSpec() {
        return currentTaskSpec;
      },
      cwd,
      startedAt,
      agentPort: delegatePort,
      turn: delegationTurn,
      steer: async (newSpec: string) => {
        currentTaskSpec = newSpec;
        const languagePrompt = await this.buildLanguagePrompt(delegateToRole, request.agentRole);
        return delegatePort.supportsSteering && delegatePort.sendSteeringPrompt(`${newSpec}\n\n${languagePrompt}`);
      },
    };

    this.conversationRuntime.registerDelegation(conversationKey, activeDelegation);

    try {
      const runDelegate = (text: string) => this.runAgentTurn(
        delegatePort,
        cwd,
        delegateToRole,
        text,
        request,
        delegationTurn,
        session,
        effectiveSessionMode,
        projectName,
      );
      const response = await this.answerQuestions(
        await runDelegate(currentTaskSpec),
        runDelegate,
        this.buildAsker(delegateToRole, projectName),
        request,
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
      return this.formatAgentResult(delegateToRole, projectName, response);
    } finally {
      this.conversationRuntime.unregisterDelegation(conversationKey, activeDelegation);
      await delegatePort.closeSession().catch(() => undefined);
      await delegatePort.disconnect().catch(() => undefined);
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
      let fullPrompt = [prompt, reminder, languagePrompt].filter(Boolean).join('\n\n');
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

      if (request.onActivity) {
        unsubscribeActivity = agentPort.onActivity(request.onActivity);
      }

      turn.throwIfCancelled();
      for await (const update of agentPort.prompt(fullPrompt)) {
        const chunk = this.extractTextChunk(update);
        if (chunk) {
          accumulatedChunks += chunk;
          request.onTextChunk?.(chunk);
        }
      }

      const response = agentPort.lastAgentMessage || accumulatedChunks;
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
    const attachments = resolveAttachmentPaths(input.attachments, input.workspacePath);
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

  private extractTextChunk(update: AgentUpdate): string | undefined {
    return update.kind === 'text' ? update.text : undefined;
  }
}
