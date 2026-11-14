import { Inject, Injectable } from '@nestjs/common';

import { IConversationStorePort } from '../ports/conversation-store.port.js';
import { WebConversationEventsService } from '../services/web-conversation-events.service.js';


/** Archiving only files the conversation away: its turns, agents and board keep working. */
@Injectable()
export class ArchiveConversationUseCase {
  constructor(
    @Inject(IConversationStorePort) private readonly store: IConversationStorePort,
    private readonly events: WebConversationEventsService,
  ) {}

  async execute(conversationId: string, archived: boolean): Promise<void> {
    this.events.publishConversation(await this.store.archive(conversationId, archived));
  }
}
