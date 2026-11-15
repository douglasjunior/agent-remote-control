import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Inject, Injectable } from '@nestjs/common';

import { HISTORY_PAGE_SIZE } from '../constants/history-page.constant.js';
import { IConversationStorePort } from '../ports/conversation-store.port.js';
import { WebConversationEventsService } from '../services/web-conversation-events.service.js';
import { earlierPageStart } from '../utils/history-page.util.js';


/** The page of entries right before position `before`, which a client asks for as the reader scrolls back. */
@Injectable()
export class ListEarlierConversationEntriesUseCase {
  constructor(
    @Inject(IConversationStorePort) private readonly store: IConversationStorePort,
    private readonly events: WebConversationEventsService,
  ) {}

  async execute(conversationId: string, before: number): Promise<{ readonly entries: readonly ConversationEntry[]; readonly start: number }> {
    const history = await this.store.history(conversationId);
    const end = Math.min(before, history.length);
    const start = earlierPageStart(history, end, { size: HISTORY_PAGE_SIZE, liveDelegations: this.events.liveDelegationsOf(conversationId) });
    return { entries: history.slice(start, end), start };
  }
}
