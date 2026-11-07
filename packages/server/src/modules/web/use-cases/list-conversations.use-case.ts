import type { ConversationSummary } from '@agent-remote-control/protocol/conversation';
import { Inject, Injectable } from '@nestjs/common';

import { IConversationStorePort } from '../ports/conversation-store.port.js';


@Injectable()
export class ListConversationsUseCase {
  constructor(@Inject(IConversationStorePort) private readonly store: IConversationStorePort) {}

  execute(): Promise<readonly ConversationSummary[]> {
    return this.store.list();
  }
}
