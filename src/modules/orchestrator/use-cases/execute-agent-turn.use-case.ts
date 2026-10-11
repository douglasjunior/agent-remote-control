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
  | { readonly kind: 'delegate'; readonly delegation: ValidatedDelegation };


@Injectable()
export class ExecuteAgentTurnUseCase {
  private readonly logger = new Logger(ExecuteAgentTurnUseCase.name);
  private readonly MAX_DELEGATION_ROUNDS = 10;
  private readonly MAX_REPAIR_ATTEMPTS = 1;

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
      if (
        error instanceof PromptCancelledError
        || (error instanceof Error && error.name === 'PromptCancelledError')
      ) {
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

      prompt = await this.delegate(session!, decision.delegation, request, round, conversationKey, agentId);
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
    let decision = this.decide(response, request);

    for (let attempt = 1; decision.kind === 'invalid' && attempt <= this.MAX_REPAIR_ATTEMPTS; attempt++) {
      this.logger.warn(
        `[Delegation Repair] Session=${session.sessionId}, Attempt=${attempt}: ${decision.reason}`,
      );
      response = await runCeo(buildDelegationRepairPrompt(decision.reason));
      decision = this.decide(response, request);
    }

    return { response, decision };
  }

  private decide(response: string, request: TurnRequest): ValidatedDecision {
    const decision = this.delegationDetector.detect(response);
    if (decision.kind !== 'delegate') {
      return decision;
    }

    const { delegateToRole, projectName } = decision.delegation;
    if (delegateToRole === request.agentRole.toUpperCase() || !this.agentRegistry.hasRole(delegateToRole)) {
      return {
        kind: 'invalid',
        reason: `Unknown role "${delegateToRole}". Delegate only to a role listed in Your Team.`,
      };
    }

    const violation = this.checkDelegationContract(
      delegateToRole,
      this.agentRegistry.getDelegationContract(delegateToRole),
      decision.delegation,
    );
    if (violation) {
      return { kind: 'invalid', reason: violation };
    }

    if (!projectName) {
      return { kind: 'delegate', delegation: { ...decision.delegation, cwd: request.workspacePath } };
    }

    try {
      const cwd = this.workspacePort.resolveRepositoryPath(projectName);
      return { kind: 'delegate', delegation: { ...decision.delegation, cwd } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        kind: 'invalid',
        reason: `Invalid project folder "${projectName}": ${message}. Use a folder name relative to the workspaces root.`,
      };
    }
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

  private async delegate(
    session: SessionContext,
    { delegateToRole, projectName, taskSpec, sessionMode, cwd }: ValidatedDelegation,
    request: TurnRequest,
    round: number,
    conversationKey: string,
    agentId: string,
  ): Promise<string> {
    const existing = this.conversationRuntime.findActiveDelegation(conversationKey, delegateToRole);
    if (existing) {
      if (existing.agentPort.supportsSteering && await existing.steer(taskSpec)) {
        this.logger.log(
          `[Delegation Steered] Role=${delegateToRole}, NewTask="${this.preview(taskSpec)}"`,
        );
        return `[AGENT_RESULT:${delegateToRole}]\nSteering message sent to active agent.`;
      }

      this.logger.log(
        `[Delegation Restarted] Role=${delegateToRole}, Cancelling and recreating agent process (steering unavailable)`,
      );
      await existing.turn.cancel();
      await existing.agentPort.closeSession().catch(() => undefined);
      await existing.agentPort.disconnect().catch(() => undefined);
      this.conversationRuntime.unregisterDelegation(conversationKey, delegateToRole, existing);
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
      return `[AGENT_RESULT:${delegateToRole}]\n${response}`;
    } finally {
      this.conversationRuntime.unregisterDelegation(conversationKey, delegateToRole, activeDelegation);
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
  ): Promise<string> {
    let unsubscribeActivity: (() => void) | undefined;
    let accumulatedChunks = '';

    turn.activate(agentPort);

    try {
      turn.throwIfCancelled();
      await agentPort.connect();
      turn.throwIfCancelled();

      const reminder = this.agentRegistry.getTurnReminder(role);
      let fullPrompt = reminder ? `${prompt}\n\n${reminder}` : prompt;
      if (!agentPort.currentSessionId) {
        const latest = await this.findLatestSession(session);
        const storedSessionId = sessionMode === 'new'
          ? undefined
          : latest.agentSessions.find(agentSession =>
            agentSession.role === role && agentSession.agentId === agentPort.agentName)?.sessionId;
        const resumed = await this.resumeAgentSession(agentPort, workspacePath, storedSessionId);
        if (!resumed) {
          await this.workspacePort.ensureDirectory(workspacePath);
          await agentPort.createSession(workspacePath);
          fullPrompt = `${this.agentRegistry.getSystemPrompt(role)}\n\n${fullPrompt}`;
        }
        const { currentSessionId } = agentPort;
        if (currentSessionId && currentSessionId !== storedSessionId) {
          await this.bindAgentSession(latest, { role, agentId: agentPort.agentName, sessionId: currentSessionId });
        }
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

  private async bindAgentSession(session: SessionContext, binding: AgentSession): Promise<void> {
    const others = session.agentSessions.filter(agentSession =>
      agentSession.role !== binding.role || agentSession.agentId !== binding.agentId);
    await this.sessionStore.saveSession({
      ...session,
      agentSessions: [...others, binding],
      updatedAt: new Date(),
    });
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
