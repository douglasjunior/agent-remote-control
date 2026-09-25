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
import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult } from '../models/turn-result.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
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

    try {
      for (let round = 1; round <= this.MAX_DELEGATION_ROUNDS; round++) {
        const response = await this.runAgentTurn(
          ceoPort,
          request.workspacePath,
          request.agentRole,
          prompt,
          request,
          turn,
        );

        const decision = this.delegationDetector.detect(response);

        if (decision.kind === 'direct_response') {
          return { sessionId: session.sessionId, response, status: 'completed' };
        }

        if (decision.kind === 'done') {
          return {
            sessionId: session.sessionId,
            response: decision.summary,
            status: 'completed',
          };
        }

        prompt = await this.delegate(session, decision.delegation, request, round, turn);
      }

      return {
        sessionId: session.sessionId,
        response: 'Limite de delegação atingido.',
        status: 'failed',
        errorMessage: 'Max delegation rounds exceeded.',
      };
    } catch (error) {
      if (
        error instanceof PromptCancelledError
        || (error instanceof Error && error.name === 'PromptCancelledError')
      ) {
        this.logger.warn(`[Turn Cancelled] Active turn was cancelled for session=${session.sessionId}`);
        return {
          sessionId: session.sessionId,
          response: ceoPort.lastAgentMessage || '',
          status: 'cancelled',
        };
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[Turn Failed] Session=${session.sessionId}: ${errorMessage}`);

      return {
        sessionId: session.sessionId,
        response: ceoPort.lastAgentMessage || '',
        status: 'failed',
        errorMessage,
      };
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
        await this.workspacePort.ensureDirectory(workspacePath);
        await agentPort.createSession(workspacePath);
        fullPrompt = `${this.agentRegistry.getSystemPrompt(role)}\n\n${prompt}`;
      }

      const defaultModel = this.agentRegistry.getDefaultModel(role);
      if (defaultModel) {
        await agentPort.setConfig({ modelId: defaultModel });
      }

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

  private extractTextChunk({ update }: AgentUpdate): string | undefined {
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
      return update.content.text;
    }
    return undefined;
  }
}
