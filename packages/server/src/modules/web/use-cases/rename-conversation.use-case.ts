import { Inject, Injectable } from '@nestjs/common';

import { IConversationStorePort } from '../ports/conversation-store.port.js';
import { WebConversationEventsService } from '../services/web-conversation-events.service.js';


/** Every connection hears the new title, the requester included, so all lists stay the same. */
@Injectable()
export class RenameConversationUseCase {
  constructor(
    @Inject(IConversationStorePort) private readonly store: IConversationStorePort,
    private readonly events: WebConversationEventsService,
  ) {}

  async execute(conversationId: string, title: string): Promise<void> {
    this.events.publishConversation(await this.store.rename(conversationId, title));
  }
}
