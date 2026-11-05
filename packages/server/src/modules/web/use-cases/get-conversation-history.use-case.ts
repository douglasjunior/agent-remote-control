import type { ConversationState } from '@agent-remote-control/protocol/conversation';
import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Inject, Injectable } from '@nestjs/common';

import type { InterruptedWork } from '../../orchestrator/models/open-work.model.js';
import { IAgentTurnPort } from '../../orchestrator/ports/agent-turn.port.js';
import { IUserQuestionPort } from '../../orchestrator/ports/user-question.port.js';
import { IConversationStorePort } from '../ports/conversation-store.port.js';
import { WebConversationEventsService } from '../services/web-conversation-events.service.js';
import { questionEntry } from '../utils/conversation-entry.util.js';


@Injectable()
export class GetConversationHistoryUseCase {
  constructor(
    @Inject(IConversationStorePort) private readonly store: IConversationStorePort,
    private readonly events: WebConversationEventsService,
    @Inject(IUserQuestionPort) private readonly userQuestions: IUserQuestionPort,
    @Inject(IAgentTurnPort) private readonly agentTurn: IAgentTurnPort,
  ) {}

  async execute(conversationId: string): Promise<{
    readonly entries: readonly ConversationEntry[];
    readonly state: ConversationState;
    readonly draft: string;
    readonly interrupted: readonly InterruptedWork[];
  }> {
    await this.settleQuestions(conversationId);
    return {
      entries: await this.store.history(conversationId),
      state: this.events.stateOf(conversationId),
      draft: this.events.draftOf(conversationId),
      interrupted: this.agentTurn.listInterruptedWork(conversationId),
    };
  }

  /** A restart may have left the card of the waiting question open, closed or, past the first question, not yet shown. */
  private async settleQuestions(conversationId: string): Promise<void> {
    const waiting = this.userQuestions.currentQuestion(conversationId);
    await this.events.settleOrphanedQuestions(conversationId, entry =>
      entry.text === waiting?.question.text && entry.askerRole === waiting.asker.role);
    if (waiting && !this.events.hasOpenQuestion(conversationId)) {
      await this.events.publishEntry(conversationId, questionEntry(waiting));
    }
  }
}
