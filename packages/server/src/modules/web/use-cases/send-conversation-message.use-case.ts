import type { ConversationState } from '@agent-remote-control/protocol/conversation';
import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Inject, Injectable, Logger } from '@nestjs/common';

import type { AgentActivity } from '../../agent/ports/agent.port.js';
import type { DelegationEvent } from '../../orchestrator/models/delegation-event.model.js';
import type { TurnResult } from '../../orchestrator/models/turn-result.model.js';
import type { QuestionPrompt } from '../../orchestrator/models/user-question.model.js';
import { IAgentConfigurationPort } from '../../orchestrator/ports/agent-configuration.port.js';
import { IAgentTurnPort } from '../../orchestrator/ports/agent-turn.port.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import { IConversationStorePort } from '../ports/conversation-store.port.js';
import { IPromptHistoryPort } from '../ports/prompt-history.port.js';
import { WebConversationEventsService } from '../services/web-conversation-events.service.js';
import {
  activityEntry,
  agentResponseEntry,
  delegationEntry,
  interimEntry,
  noticeEntry,
  questionEntry,
  userMessageEntry,
} from '../utils/conversation-entry.util.js';


const TITLE_MAX_LENGTH = 60;
const NOT_CONFIGURED_NOTICE = 'Choose an agent, model and effort for this conversation before sending messages.';
const WEB_USER_ID = 'web-local';

@Injectable()
export class SendConversationMessageUseCase {
  private readonly logger = new Logger(SendConversationMessageUseCase.name);

  constructor(
    @Inject(IAgentTurnPort) private readonly agentTurn: IAgentTurnPort,
    @Inject(IAgentConfigurationPort) private readonly configuration: IAgentConfigurationPort,
    private readonly events: WebConversationEventsService,
    @Inject(IConversationStorePort) private readonly store: IConversationStorePort,
    @Inject(IWorkspacePort) private readonly workspace: IWorkspacePort,
    @Inject(IPromptHistoryPort) private readonly promptHistory: IPromptHistoryPort,
  ) {}

  /** Never rejects: failures are reported as `notice` entries. */
  async execute(conversationId: string, text: string): Promise<void> {
    let running = false;
    try {
      if (!await this.isConfigured(conversationId)) {
        await this.events.publishEntry(conversationId, noticeEntry('warning', NOT_CONFIGURED_NOTICE));
        return;
      }
      await this.recordUserMessage(conversationId, text);
      running = true;
      await this.runTurn(conversationId, text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error processing web message for ${conversationId}: ${message}`);
      await this.events.publishEntry(conversationId, noticeEntry('error', `An error occurred while processing your request: ${message}`));
      if (running) {
        this.finish(conversationId);
      }
    }
  }

  /** Without any installed agent the turn runs with the default one, so only a choosable agent is required. */
  private async isConfigured(conversationId: string): Promise<boolean> {
    return await this.configuration.ensureSettings(conversationId) !== 'missing' || this.configuration.listAgents().length === 0;
  }

  private async recordUserMessage(conversationId: string, text: string): Promise<void> {
    const isFirstMessage = !(await this.store.history(conversationId)).some(entry => entry.type === 'user_message');
    await this.events.publishEntry(conversationId, userMessageEntry(text));
    await this.promptHistory.append(text);
    const conversation = isFirstMessage
      ? await this.store.rename(conversationId, this.titleFrom(text))
      : await this.store.touch(conversationId);
    this.events.publishConversation(conversation);
  }

  private titleFrom(text: string): string {
    const firstLine = text.split('\n').find(line => line.trim())?.trim() ?? text.trim();
    return firstLine.slice(0, TITLE_MAX_LENGTH);
  }

  private async runTurn(conversationId: string, prompt: string): Promise<void> {
    let state: ConversationState = 'running';
    this.events.publishState(conversationId, state);
    const markRunning = (): void => {
      if (state !== 'running') {
        state = 'running';
        this.events.publishState(conversationId, state);
      }
    };
    const publish = (entry: ConversationEntry): void => {
      markRunning();
      void this.events.publishEntry(conversationId, entry);
    };

    const result: TurnResult = await this.agentTurn.executeTurn({
      conversationId,
      userId: WEB_USER_ID,
      prompt,
      workspacePath: this.workspace.getBaseDirectory(),
      agentRole: 'CEO',
      onActivity: (activity: AgentActivity) => {
        const entry = activityEntry(activity);
        if (entry) {
          publish(entry);
        }
      },
      onDelegation: (event: DelegationEvent) => publish(delegationEntry(event)),
      onInterimMessage: (message: string) => publish(interimEntry(message)),
      onQuestion: (question: QuestionPrompt) => publish(questionEntry(question)),
      onQueued: () => {
        state = 'queued';
        this.events.publishState(conversationId, state);
      },
    });

    await this.events.publishEntry(conversationId, agentResponseEntry(result));
    if (result.status !== 'steered') {
      this.finish(conversationId);
    }
  }

  /** The running turn that absorbed a steered prompt returns the conversation to idle itself. */
  private finish(conversationId: string): void {
    this.events.publishState(conversationId, 'idle');
    void this.store.flush(conversationId).catch((error: unknown) => {
      this.logger.warn(`flush_failed: ${conversationId}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}
