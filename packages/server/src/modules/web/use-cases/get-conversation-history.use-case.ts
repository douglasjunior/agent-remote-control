import type { ConversationState } from '@agent-remote-control/protocol/conversation';
import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Inject, Injectable } from '@nestjs/common';

import type { InterruptedWork } from '../../orchestrator/models/open-work.model.js';
import { IAgentTurnPort } from '../../orchestrator/ports/agent-turn.port.js';
import { IUserQuestionPort } from '../../orchestrator/ports/user-question.port.js';
import { HISTORY_PAGE_SIZE } from '../constants/history-page.constant.js';
import { IConversationStorePort } from '../ports/conversation-store.port.js';
import { ConversationEntryService } from '../services/conversation-entry.service.js';
import { WebConversationEventsService } from '../services/web-conversation-events.service.js';
import { latestPageStart } from '../utils/history-page.util.js';


/** What a client needs to open a conversation: its latest page of entries, from position `start`, and its present state. */
@Injectable()
export class GetConversationHistoryUseCase {
  constructor(
    @Inject(IConversationStorePort) private readonly store: IConversationStorePort,
    private readonly events: WebConversationEventsService,
    @Inject(IUserQuestionPort) private readonly userQuestions: IUserQuestionPort,
    @Inject(IAgentTurnPort) private readonly agentTurn: IAgentTurnPort,
    private readonly entries: ConversationEntryService,
  ) {}

  async execute(conversationId: string): Promise<{
    readonly entries: readonly ConversationEntry[];
    readonly start: number;
    readonly state: ConversationState;
    readonly draft: string;
    readonly interrupted: readonly InterruptedWork[];
  }> {
    await this.settleQuestions(conversationId);
    const history = await this.store.history(conversationId);
    const start = latestPageStart(history, { size: HISTORY_PAGE_SIZE, liveDelegations: this.events.liveDelegationsOf(conversationId) });
    return {
      entries: history.slice(start),
      start,
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
      await this.events.publishEntry(conversationId, this.entries.question(waiting));
    }
  }
}
