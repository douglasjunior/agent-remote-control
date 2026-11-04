import type { ConversationSummary } from '@agent-remote-control/protocol/conversation';
import { Inject, Injectable } from '@nestjs/common';

import { IConversationStorePort } from '../ports/conversation-store.port.js';


@Injectable()
export class CreateConversationUseCase {
  constructor(@Inject(IConversationStorePort) private readonly store: IConversationStorePort) {}

  execute(): Promise<ConversationSummary> {
    return this.store.create();
  }
}
