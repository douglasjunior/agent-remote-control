import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

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
import type { AgentSettings } from '../models/agent-settings.model.js';
import type { SessionContext } from '../models/session-context.model.js';
import type { TurnAgentInfo } from '../models/turn-agent-info.model.js';
import type { TurnAttachment } from '../models/turn-attachment.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult, TurnStatus } from '../models/turn-result.model.js';
import {
  type DelegationContract,
  IAgentRegistryPort,
} from '../ports/agent-registry.port.js';
import { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';
import { ISessionStorePort } from '../ports/session-store.port.js';
import { buildCeoSteeringPrompt } from '../prompts/ceo-steering.prompt.js';
import { buildDelegationRepairPrompt } from '../prompts/delegation-repair.prompt.js';
import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';
import {
  type CeoDecision,
  type DelegationResult,
  DelegationDetectorService,
} from '../services/delegation-detector.service.js';
import { extractAttachments } from '../utils/attachment-extractor.util.js';


const LOG_PREVIEW_LENGTH = 100;

type ValidatedDelegation = DelegationResult & { readonly cwd: string };

type ValidatedDecision =
  | Exclude<CeoDecision, { kind: 'delegate' }>
  | { readonly kind: 'delegate'; readonly delegations: readonly ValidatedDelegation[] };


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
    private readonly delegationDetector: DelegationDetectorService,
    private readonly conversationRuntime: ConversationRuntimeService,
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
    let agentId = this.agentPortFactory.defaultAgentId;
    const currentCeoPort = () => ceoPort ?? this.conversationRuntime.getCeoPort(conversationKey);
    const finish = (status: TurnStatus, response: string, errorMessage?: string) =>
      this.buildResult({
        sessionId: session?.sessionId,
        ceoPort: currentCeoPort(),
        agentId,
        role: request.agentRole,
        status,
        response,
        errorMessage,
        workspacePath: request.workspacePath,
        conversationId: request.conversationId,
      });

    try {
      agentId = (await this.settingsStore.load(request.conversationId))?.agentId ?? agentId;
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
      const sessionLabel = session?.sessionId ?? 'none';
      if (this.isCancellation(error)) {
        this.logger.warn(`[Turn Cancelled] Active turn was cancelled for session=${sessionLabel}`);
        return finish('cancelled', currentCeoPort()?.lastAgentMessage ?? '');
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[Turn Failed] Session=${sessionLabel}: ${errorMessage}`);

      return finish('failed', currentCeoPort()?.lastAgentMessage ?? '', errorMessage);
    }
  }

  private async runDelegationLoop(
    conversationKey: string,
    agentId: string,
    request: TurnRequest,
    finish: (status: TurnStatus, response: string, errorMessage?: string) => Promise<TurnResult>,
    observers: {
      readonly onSessionResolved: (session: SessionContext) => void;
      readonly onCeoPort: (ceoPort: IAgentPort) => void;
    },
  ): Promise<TurnResult> {
    let session: SessionContext | undefined;
    let prompt = this.enrichPromptWithAttachments(request.prompt, request.attachments);

    for (let round = 1; ; round++) {
      const { response, decision } = await this.conversationRuntime.runOnCeo(
        conversationKey,
        agentId,
        async (ceoPort, turn) => {
          observers.onCeoPort(ceoPort);
          if (!session) {
            session = await this.resolveSession(request);
            observers.onSessionResolved(session);
            this.logger.log(
              `[Turn Started] Session=${session.sessionId}, User=${request.userId}, Conversation=${request.conversationId}, Role=${request.agentRole}`,
            );
            const activeDelegations = this.conversationRuntime.getActiveDelegations(conversationKey);
            if (activeDelegations.length > 0) {
              prompt = `${this.formatActiveDelegations(activeDelegations)}\n${prompt}`;
            }
          }
          return this.runCeoTurn(ceoPort, prompt, request, turn, session);
        },
        round === 1 ? request.onQueued : undefined,
      );

      if (decision.kind === 'invalid') {
        return finish('failed', response, `Invalid CEO response: ${decision.reason}`);
      }

      if (decision.kind === 'direct_response') {
        return finish('completed', response);
      }

      if (decision.kind === 'done') {
        return finish('completed', decision.summary);
      }

      if (round === this.MAX_DELEGATION_ROUNDS) {
        return finish('failed', 'Limite de delegação atingido.', 'Max delegation rounds exceeded.');
      }

      prompt = await this.delegateAll(session!, decision.delegations, request, round, conversationKey, agentId);
    }
  }

  private async steerRunningCeo(
    conversationKey: string,
    agentId: string,
    request: TurnRequest,
  ): Promise<boolean> {
    const prompt = buildCeoSteeringPrompt(this.enrichPromptWithAttachments(request.prompt, request.attachments));
    const reminder = this.agentRegistry.getTurnReminder(request.agentRole);
    const steered = await this.conversationRuntime.steerCeo(
      conversationKey,
      agentId,
      reminder ? `${prompt}\n\n${reminder}` : prompt,
    );
    if (steered) {
      this.logger.log(
        `[CEO Steered] Conversation=${conversationKey}, User=${request.userId}, Prompt="${this.preview(request.prompt)}"`,
      );
    }
    return steered;
  }

  private async buildSteeredResult(conversationKey: string, request: TurnRequest): Promise<TurnResult> {
    const session = await this.sessionStore.findSession(request.conversationId);
    const ceoPort = this.conversationRuntime.getCeoPort(conversationKey)!;
    return {
      sessionId: session?.sessionId,
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

  private formatActiveDelegations(delegations: readonly ActiveDelegation[]): string {
    const lines = delegations.map(
      delegation => `- Role: ${delegation.role}, Project: ${delegation.projectName ?? 'none'}, Task: "${delegation.taskSpec}"`,
    );
    return `[ACTIVE_DELEGATIONS]\n${lines.join('\n')}\n`;
  }

  private async resolveSession(request: TurnRequest): Promise<SessionContext> {
    const existing = await this.sessionStore.findSession(request.conversationId);
    const now = new Date();

    const session: SessionContext = existing
      ? { ...existing, updatedAt: now }
      : {
        sessionId: randomUUID(),
        conversationId: request.conversationId,
        userId: request.userId,
        workspacePath: request.workspacePath,
        agentRole: request.agentRole,
        agentSessions: [],
        createdAt: now,
        updatedAt: now,
      };

    await this.sessionStore.saveSession(session);
    return session;
  }

  private async runCeoTurn(
    ceoPort: IAgentPort,
    prompt: string,
    request: TurnRequest,
    turn: ActiveTurn,
    session: SessionContext,
  ): Promise<{ response: string; decision: ValidatedDecision }> {
    const runCeo = (text: string) => this.runAgentTurn(
      ceoPort,
      request.workspacePath,
      request.agentRole,
      text,
      request,
      turn,
      session,
    );

    let response = await runCeo(prompt);
    let decision = await this.decide(response, request);

    for (let attempt = 1; decision.kind === 'invalid' && attempt <= this.MAX_REPAIR_ATTEMPTS; attempt++) {
      this.logger.warn(
        `[Delegation Repair] Session=${session.sessionId}, Attempt=${attempt}: ${decision.reason}`,
      );
      response = await runCeo(buildDelegationRepairPrompt(decision.reason));
      decision = await this.decide(response, request);
    }

    return { response, decision };
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
    return conflict ? { kind: 'invalid', reason: conflict } : { kind: 'delegate', delegations };
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
   * Agents that modify files would overwrite each other's work in the same folder. A delegation to a role
   * already working in the same project redirects that agent, so the running one does not count against it.
   */
  private findParallelConflict(delegations: readonly ValidatedDelegation[], conversationKey: string): string | undefined {
    const targets = new Set<string>();
    for (const { delegateToRole, projectName } of delegations) {
      const target = `${delegateToRole}:${projectName ?? ''}`;
      if (targets.has(target)) {
        return `${delegateToRole} appears more than once for ${this.describeTarget(projectName)}. Merge those tasks into a single delegation.`;
      }
      targets.add(target);
    }

    const writers = new Map<string, string>();
    for (const active of this.conversationRuntime.getActiveDelegations(conversationKey)) {
      const redirected = delegations.some(delegation =>
        delegation.delegateToRole === active.role.toUpperCase() && (delegation.projectName ?? null) === active.projectName);
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

  // TODO: devemos pensar numa forma melhor e mais genéricas de validar os parâmetros de delegação
  // talvez cada agente ter um zod schema que valide seus parâmetros, não sei ainda...
  private checkDelegationContract(
    role: string,
    contract: DelegationContract,
    { projectName, sessionMode }: DelegationResult,
  ): string | undefined {
    if (projectName && !contract.project) {
      return `Role "${role}" does not take a project folder. Use [DELEGATE:${role}].`;
    }
    if (!projectName && contract.project === 'required') {
      return `Role "${role}" requires a project folder. Use [DELEGATE:${role}:<project-folder>].`;
    }
    if (sessionMode && !contract.sessionMode) {
      return `Role "${role}" does not take a session mode. Use [DELEGATE:${role}${projectName ? `:${projectName}` : ''}] without ":${sessionMode}".`;
    }
    return undefined;
  }

  /** Waits for every delegation, so no agent keeps running unobserved after another one fails. */
  private async delegateAll(
    session: SessionContext,
    delegations: readonly ValidatedDelegation[],
    request: TurnRequest,
    round: number,
    conversationKey: string,
    agentId: string,
  ): Promise<string> {
    const outcomes = await Promise.allSettled(
      delegations.map(delegation => this.delegate(session, delegation, request, round, conversationKey, agentId)),
    );
    const failures = outcomes.flatMap(outcome => (outcome.status === 'rejected' ? [outcome.reason as unknown] : []));
    if (failures.length > 0) {
      throw failures.find(failure => this.isCancellation(failure)) ?? failures[0];
    }
    return outcomes
      .map(outcome => (outcome as PromiseFulfilledResult<string>).value)
      .join('\n\n');
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
    agentId: string,
  ): Promise<string> {
    const resultHeader = `[AGENT_RESULT:${delegateToRole}${projectName ? `:${projectName}` : ''}]`;
    const existing = this.conversationRuntime.findActiveDelegation(conversationKey, delegateToRole, projectName ?? null);
    if (existing) {
      if (existing.agentPort.supportsSteering && await existing.steer(taskSpec)) {
        this.logger.log(
          `[Delegation Steered] Role=${delegateToRole}, NewTask="${this.preview(taskSpec)}"`,
        );
        return `${resultHeader}\nSteering message sent to active agent.`;
      }

      this.logger.log(
        `[Delegation Restarted] Role=${delegateToRole}, Cancelling and recreating agent process (steering unavailable)`,
      );
      await existing.turn.cancel();
      await existing.agentPort.closeSession().catch(() => undefined);
      await existing.agentPort.disconnect().catch(() => undefined);
      this.conversationRuntime.unregisterDelegation(conversationKey, existing);
    }

    const delegatePort = this.agentPortFactory.create(agentId);
    const event = {
      round,
      role: delegateToRole,
      roleName: this.agentRegistry.getDisplayName(delegateToRole),
      projectName,
    };
    const startedAt = Date.now();

    this.logger.log(
      `[Delegation Started] Session=${session.sessionId}, Round=${round}, Role=${delegateToRole} (${event.roleName}), Project=${projectName ?? 'none'}, Cwd=${cwd}, Task="${this.preview(taskSpec)}"`,
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
        return delegatePort.supportsSteering && delegatePort.sendSteeringPrompt(newSpec);
      },
    };

    this.conversationRuntime.registerDelegation(conversationKey, activeDelegation);

    try {
      const response = await this.runAgentTurn(
        delegatePort,
        cwd,
        delegateToRole,
        currentTaskSpec,
        request,
        delegationTurn,
        session,
        effectiveSessionMode,
        projectName,
      );
      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `[Delegation Finished] Session=${session.sessionId}, Round=${round}, Role=${delegateToRole}, Duration=${(durationMs / 1000).toFixed(1)}s, ResponseLength=${response.length}`,
      );
      request.onDelegation?.({
        ...event,
        phase: 'finished',
        response,
        agentInfo: await this.buildAgentInfo(delegatePort, delegateToRole, request.conversationId),
        usage: await delegatePort.getLastRoundUsage().catch(() => undefined),
        durationMs,
      });
      return `${resultHeader}\n${response}`;
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
  ): Promise<string> {
    let unsubscribeActivity: (() => void) | undefined;
    let accumulatedChunks = '';

    turn.activate(agentPort);

    try {
      turn.throwIfCancelled();
      await agentPort.connect();
      turn.throwIfCancelled();

      const systemPromptEveryTurn = this.agentRegistry.isSystemPromptEveryTurn(role);
      const reminder = this.agentRegistry.getTurnReminder(role);
      let fullPrompt = reminder ? `${prompt}\n\n${reminder}` : prompt;
      let systemPromptPending = systemPromptEveryTurn;
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
        updatedAt: new Date(),
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
    const settings = await this.findAgentSettings(agentPort, conversationId);
    if (settings?.modelId) {
      await agentPort.setConfig({
        modelId: settings.modelId,
        effortId: settings.effortId ?? undefined,
      });
      return;
    }

    const defaultModel = this.agentRegistry.getDefaultModel(role);
    if (defaultModel) {
      await agentPort.setConfig({ modelId: defaultModel });
    }
  }

  /** Settings saved for another agent carry model ids that this agent does not know. */
  private async findAgentSettings(agentPort: IAgentPort, conversationId: string): Promise<AgentSettings | undefined> {
    const settings = await this.settingsStore.load(conversationId);
    return settings?.agentId === agentPort.agentName ? settings : undefined;
  }

  private async buildResult(input: {
    sessionId?: string;
    ceoPort?: IAgentPort;
    agentId: string;
    role: string;
    status: TurnStatus;
    response: string;
    errorMessage?: string;
    workspacePath?: string;
    conversationId: string;
  }): Promise<TurnResult> {
    const attachments = extractAttachments(input.response, input.workspacePath);
    return {
      sessionId: input.sessionId,
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
    const settings = await this.findAgentSettings(agentPort, conversationId);
    return {
      roleName: this.agentRegistry.getDisplayName(role),
      agentName: agentPort.agentName,
      modelName: settings?.modelName ?? this.currentModelName(agentPort),
      effortName: settings?.effortName ?? undefined,
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
