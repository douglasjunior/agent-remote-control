import type { ConversationState } from '@agent-remote-control/protocol/conversation';
import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Inject, Injectable } from '@nestjs/common';

import { IConversationStorePort } from '../ports/conversation-store.port.js';
import { WebConversationEventsService } from '../services/web-conversation-events.service.js';


@Injectable()
export class GetConversationHistoryUseCase {
  constructor(
    @Inject(IConversationStorePort) private readonly store: IConversationStorePort,
    private readonly events: WebConversationEventsService,
  ) {}

  async execute(conversationId: string): Promise<{
    readonly entries: readonly ConversationEntry[];
    readonly state: ConversationState;
    readonly draft: string;
  }> {
    return {
      entries: await this.store.history(conversationId),
      state: this.events.stateOf(conversationId),
      draft: this.events.draftOf(conversationId),
    };
  }
}
