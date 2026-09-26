import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import {
  type AgentUpdate,
  PromptCancelledError,
  IAgentPort,
} from '../../agent/ports/agent.port.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import type { ActiveTurn } from '../models/active-turn.model.js';
import type { SessionContext } from '../models/session-context.model.js';
import type { TurnAgentInfo } from '../models/turn-agent-info.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult, TurnStatus } from '../models/turn-result.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';
import { ISessionStorePort } from '../ports/session-store.port.js';
import { buildDelegationRepairPrompt } from '../prompts/delegation-repair.prompt.js';
import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';
import {
  type CeoDecision,
  type DelegationResult,
  DelegationDetectorService,
} from '../services/delegation-detector.service.js';
import { extractAttachments } from '../utils/attachment-extractor.util.js';
import { buildConversationKey } from '../utils/conversation-key.util.js';


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
    return this.conversationRuntime.run(
      buildConversationKey(request.channelId, request.threadId),
      (agentPort, turn) => this.runTurn(agentPort, turn, request),
      request.onQueued,
    );
  }

  private async runTurn(
    ceoPort: IAgentPort,
    turn: ActiveTurn,
    request: TurnRequest,
  ): Promise<TurnResult> {
    let session: SessionContext | undefined;
    const finish = (status: TurnStatus, response: string, errorMessage?: string) =>
      this.buildResult({
        sessionId: session?.sessionId,
        ceoPort,
        role: request.agentRole,
        status,
        response,
        errorMessage,
        workspacePath: request.workspacePath,
      });

    try {
      session = await this.resolveSession(request);
      this.logger.log(
        `[Turn Started] Session=${session.sessionId}, User=${request.userId}, Channel=${request.channelId}, Thread=${request.threadId ?? 'none'}, Role=${request.agentRole}`,
      );
      return await this.runDelegationLoop(session, ceoPort, turn, request, finish);
    } catch (error) {
      const sessionLabel = session?.sessionId ?? 'none';
      if (
        error instanceof PromptCancelledError
        || (error instanceof Error && error.name === 'PromptCancelledError')
      ) {
        this.logger.warn(`[Turn Cancelled] Active turn was cancelled for session=${sessionLabel}`);
        return finish('cancelled', ceoPort.lastAgentMessage || '');
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[Turn Failed] Session=${sessionLabel}: ${errorMessage}`);

      const result = await finish('failed', ceoPort.lastAgentMessage || '', errorMessage);
      await ceoPort.disconnect().catch(() => undefined);
      return result;
    }
  }

  private async runDelegationLoop(
    session: SessionContext,
    ceoPort: IAgentPort,
    turn: ActiveTurn,
    request: TurnRequest,
    finish: (status: TurnStatus, response: string, errorMessage?: string) => Promise<TurnResult>,
  ): Promise<TurnResult> {
    let prompt = request.prompt;
    for (let round = 1; ; round++) {
      const { response, decision } = await this.runCeoTurn(ceoPort, prompt, request, turn, session);

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

      prompt = await this.delegate(session, decision.delegation, request, round, turn);
    }
  }

  private async resolveSession(request: TurnRequest): Promise<SessionContext> {
    const existing = await this.sessionStore.findSession(request.channelId, request.threadId);
    const now = new Date();

    const session: SessionContext = existing
      ? { ...existing, updatedAt: now }
      : {
        sessionId: randomUUID(),
        channelId: request.channelId,
        threadId: request.threadId,
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

  private async delegate(
    session: SessionContext,
    { delegateToRole, projectName, taskSpec, cwd }: ValidatedDelegation,
    request: TurnRequest,
    round: number,
    turn: ActiveTurn,
  ): Promise<string> {
    const delegatePort = this.agentPortFactory.create();
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

    try {
      const response = await this.runAgentTurn(
        delegatePort,
        cwd,
        delegateToRole,
        taskSpec,
        request,
        turn,
        session,
      );
      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `[Delegation Finished] Session=${session.sessionId}, Round=${round}, Role=${delegateToRole}, Duration=${(durationMs / 1000).toFixed(1)}s, ResponseLength=${response.length}`,
      );
      request.onDelegation?.({
        ...event,
        phase: 'finished',
        response,
        agentInfo: await this.buildAgentInfo(delegatePort, delegateToRole),
        usage: await delegatePort.getLastRoundUsage().catch(() => undefined),
        durationMs,
      });
      return `[AGENT_RESULT:${delegateToRole}]\n${response}`;
    } finally {
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
  ): Promise<string> {
    let unsubscribeActivity: (() => void) | undefined;
    let accumulatedChunks = '';

    turn.activate(agentPort);

    try {
      turn.throwIfCancelled();
      await agentPort.connect();
      turn.throwIfCancelled();

      let fullPrompt = prompt;
      if (!agentPort.currentSessionId) {
        const latest = await this.findLatestSession(session);
        const storedSessionId = latest.agentSessions.find(agentSession => agentSession.role === role)?.sessionId;
        const resumed = await this.resumeAgentSession(agentPort, workspacePath, storedSessionId);
        if (!resumed) {
          await this.workspacePort.ensureDirectory(workspacePath);
          await agentPort.createSession(workspacePath);
          fullPrompt = `${this.agentRegistry.getSystemPrompt(role)}\n\n${prompt}`;
        }
        const { currentSessionId } = agentPort;
        if (currentSessionId && currentSessionId !== storedSessionId) {
          await this.bindAgentSession(latest, role, currentSessionId);
        }
      }

      await this.applyAgentConfig(agentPort, role);

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
    return await this.sessionStore.findSession(session.channelId, session.threadId) ?? session;
  }

  private async bindAgentSession(session: SessionContext, role: string, sessionId: string): Promise<void> {
    await this.sessionStore.saveSession({
      ...session,
      agentSessions: [...session.agentSessions.filter(agentSession => agentSession.role !== role), { role, sessionId }],
      updatedAt: new Date(),
    });
  }

  private async applyAgentConfig(agentPort: IAgentPort, role: string): Promise<void> {
    const settings = await this.settingsStore.load();
    if (settings) {
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

  private async buildResult(input: {
    sessionId?: string;
    ceoPort: IAgentPort;
    role: string;
    status: TurnStatus;
    response: string;
    errorMessage?: string;
    workspacePath?: string;
  }): Promise<TurnResult> {
    const attachments = extractAttachments(input.response, input.workspacePath);
    return {
      sessionId: input.sessionId,
      response: input.response,
      status: input.status,
      errorMessage: input.errorMessage,
      agentInfo: await this.buildAgentInfo(input.ceoPort, input.role),
      usage: await input.ceoPort.getLastRoundUsage().catch(() => undefined),
      ...(attachments.length > 0 ? { attachments } : {}),
    };
  }

  private async buildAgentInfo(agentPort: IAgentPort, role: string): Promise<TurnAgentInfo> {
    const settings = await this.settingsStore.load();
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
