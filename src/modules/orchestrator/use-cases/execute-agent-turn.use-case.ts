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
import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';
import {
  type DelegationResult,
  DelegationDetectorService,
} from '../services/delegation-detector.service.js';


@Injectable()
export class ExecuteAgentTurnUseCase {
  private readonly logger = new Logger(ExecuteAgentTurnUseCase.name);
  private readonly MAX_DELEGATION_ROUNDS = 10;

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
    const session = await this.resolveSession(request);

    return this.conversationRuntime.run(
      session.sessionId,
      (agentPort, turn) => this.runTurn(session, agentPort, turn, request),
      request.onQueued,
    );
  }

  private async runTurn(
    session: SessionContext,
    ceoPort: IAgentPort,
    turn: ActiveTurn,
    request: TurnRequest,
  ): Promise<TurnResult> {
    this.logger.log(
      `[Turn Started] Session=${session.sessionId}, User=${request.userId}, Channel=${request.channelId}, Thread=${request.threadId ?? 'none'}, Role=${request.agentRole}`,
    );

    let prompt = request.prompt;
    const finish = (status: TurnStatus, response: string, errorMessage?: string) =>
      this.buildResult({ session, ceoPort, role: request.agentRole, status, response, errorMessage });

    try {
      for (let round = 1; round <= this.MAX_DELEGATION_ROUNDS; round++) {
        const response = await this.runAgentTurn(
          ceoPort,
          request.workspacePath,
          request.agentRole,
          prompt,
          request,
          turn,
          session,
        );

        const decision = this.delegationDetector.detect(response);

        if (decision.kind === 'direct_response') {
          return await finish('completed', response);
        }

        if (decision.kind === 'done') {
          return await finish('completed', decision.summary);
        }

        prompt = await this.delegate(session, decision.delegation, request, round, turn);
      }

      return await finish(
        'failed',
        'Limite de delegação atingido.',
        'Max delegation rounds exceeded.',
      );
    } catch (error) {
      if (
        error instanceof PromptCancelledError
        || (error instanceof Error && error.name === 'PromptCancelledError')
      ) {
        this.logger.warn(`[Turn Cancelled] Active turn was cancelled for session=${session.sessionId}`);
        return finish('cancelled', ceoPort.lastAgentMessage || '');
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[Turn Failed] Session=${session.sessionId}: ${errorMessage}`);

      const result = await finish('failed', ceoPort.lastAgentMessage || '', errorMessage);
      await ceoPort.disconnect().catch(() => undefined);
      return result;
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
        createdAt: now,
        updatedAt: now,
      };

    await this.sessionStore.saveSession(session);
    return session;
  }

  private async delegate(
    session: SessionContext,
    { delegateToRole, projectName, taskSpec }: DelegationResult,
    request: TurnRequest,
    round: number,
    turn: ActiveTurn,
  ): Promise<string> {
    const cwd = projectName
      ? this.workspacePort.resolveRepositoryPath(projectName)
      : request.workspacePath;
    const delegatePort = this.agentPortFactory.create();

    this.logger.log(
      `[Delegation] Session=${session.sessionId}, Round=${round}, Role=${delegateToRole}, Cwd=${cwd}`,
    );

    try {
      const response = await this.runAgentTurn(
        delegatePort,
        cwd,
        delegateToRole,
        taskSpec,
        request,
        turn,
      );
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
    session?: SessionContext,
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
        const resumed = await this.resumeAgentSession(
          agentPort,
          workspacePath,
          session?.agentSessionId,
        );
        if (!resumed) {
          await this.workspacePort.ensureDirectory(workspacePath);
          await agentPort.createSession(workspacePath);
          fullPrompt = `${this.agentRegistry.getSystemPrompt(role)}\n\n${prompt}`;
        }
        if (session) {
          await this.bindAgentSession(session, agentPort.currentSessionId);
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

      return agentPort.lastAgentMessage || accumulatedChunks;
    } finally {
      unsubscribeActivity?.();
    }
  }

  private async resumeAgentSession(
    agentPort: IAgentPort,
    workspacePath: string,
    agentSessionId: string | undefined,
  ): Promise<boolean> {
    if (!agentSessionId) {
      return false;
    }
    const loaded = await agentPort.loadSession(workspacePath, agentSessionId);
    this.logger.log(
      `[Agent Session ${loaded ? 'Resumed' : 'Not Resumed'}] AgentSession=${agentSessionId}`,
    );
    return loaded;
  }

  private async bindAgentSession(
    session: SessionContext,
    agentSessionId: string | undefined,
  ): Promise<void> {
    if (!agentSessionId || agentSessionId === session.agentSessionId) {
      return;
    }
    await this.sessionStore.saveSession({ ...session, agentSessionId, updatedAt: new Date() });
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
    session: SessionContext;
    ceoPort: IAgentPort;
    role: string;
    status: TurnStatus;
    response: string;
    errorMessage?: string;
  }): Promise<TurnResult> {
    const settings = await this.settingsStore.load();
    const agentInfo: TurnAgentInfo = {
      roleName: this.agentRegistry.getDisplayName(input.role),
      agentName: input.ceoPort.agentName,
      modelName: settings?.modelName ?? this.currentModelName(input.ceoPort),
      effortName: settings?.effortName ?? undefined,
    };
    return {
      sessionId: input.session.sessionId,
      response: input.response,
      status: input.status,
      errorMessage: input.errorMessage,
      agentInfo,
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
