import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type AgentUpdate,
  IAgentPort,
  PromptCancelledError,
} from '../../agent/ports/agent.port.js';
import type { SessionContext } from '../models/session-context.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult } from '../models/turn-result.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { ISessionStorePort } from '../ports/session-store.port.js';

@Injectable()
export class ExecuteAgentTurnUseCase {
  constructor(
    @Inject(IAgentPort)
    private readonly agentPort: IAgentPort,
    @Inject(ISessionStorePort)
    private readonly sessionStore: ISessionStorePort,
    @Inject(IAgentRegistryPort)
    private readonly agentRegistry: IAgentRegistryPort,
  ) {}

  async execute(request: TurnRequest): Promise<TurnResult> {
    let session: SessionContext | null = null;
    let unsubscribeActivity: (() => void) | undefined;
    let accumulatedChunks = '';

    try {
      session = await this.sessionStore.findSession(
        request.channelId,
        request.threadId,
      );

      const isFirstTurn = !session;
      const now = new Date();

      if (!session) {
        session = {
          sessionId: randomUUID(),
          channelId: request.channelId,
          threadId: request.threadId,
          userId: request.userId,
          workspacePath: request.workspacePath,
          agentId: request.agentRole,
          createdAt: now,
          updatedAt: now,
        };
      } else {
        session = {
          ...session,
          updatedAt: now,
        };
      }

      await this.sessionStore.saveSession(session);
      await this.agentPort.connect();

      if (!this.agentPort.currentSessionId) {
        await this.agentPort.createSession(request.workspacePath);
      }

      const defaultModel = this.agentRegistry.getDefaultModel(
        request.agentRole,
      );
      if (defaultModel) {
        await this.agentPort.setConfig({ modelId: defaultModel });
      }

      if (request.onActivity) {
        unsubscribeActivity = this.agentPort.onActivity(request.onActivity);
      }

      const systemPrompt = this.agentRegistry.getSystemPrompt(
        request.agentRole,
      );
      const fullPrompt = this.buildFullPrompt(
        request.prompt,
        systemPrompt,
        isFirstTurn,
      );

      for await (const update of this.agentPort.prompt(fullPrompt)) {
        const chunk = this.extractTextChunk(update);
        if (chunk) {
          accumulatedChunks += chunk;
          request.onTextChunk?.(chunk);
        }
      }

      const usage = await this.agentPort.getLastRoundUsage();
      const response = this.agentPort.lastAgentMessage || accumulatedChunks;

      return {
        sessionId: session.sessionId,
        response,
        status: 'completed',
        usage,
      };
    } catch (error) {
      if (
        error instanceof PromptCancelledError ||
        (error instanceof Error && error.name === 'PromptCancelledError')
      ) {
        const usage = await this.agentPort
          .getLastRoundUsage()
          .catch(() => undefined);

        return {
          sessionId: session?.sessionId ?? '',
          response: this.agentPort.lastAgentMessage || accumulatedChunks,
          status: 'cancelled',
          usage,
        };
      }

      return {
        sessionId: session?.sessionId ?? '',
        response: this.agentPort.lastAgentMessage || accumulatedChunks,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    } finally {
      unsubscribeActivity?.();
    }
  }

  private buildFullPrompt(
    prompt: string,
    systemPrompt?: string,
    isFirstTurn = false,
  ): string {
    if (isFirstTurn && systemPrompt && systemPrompt.trim().length > 0) {
      return `${systemPrompt}\n\n${prompt}`;
    }
    return prompt;
  }

  private extractTextChunk(update: AgentUpdate): string | undefined {
    if (typeof update === 'string') {
      return update;
    }
    const payload = update?.update;
    if (
      payload &&
      payload.sessionUpdate === 'agent_message_chunk' &&
      payload.content?.type === 'text' &&
      typeof payload.content.text === 'string'
    ) {
      return payload.content.text;
    }
    const candidate = (update as unknown as { text?: unknown })?.text;
    if (typeof candidate === 'string') {
      return candidate;
    }
    return undefined;
  }
}
