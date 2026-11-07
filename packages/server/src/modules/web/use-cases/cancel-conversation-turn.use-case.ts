import { Inject, Injectable } from '@nestjs/common';

import { IAgentTurnPort } from '../../orchestrator/ports/agent-turn.port.js';
import { ConversationEntryService } from '../services/conversation-entry.service.js';
import { WebConversationEventsService } from '../services/web-conversation-events.service.js';


@Injectable()
export class CancelConversationTurnUseCase {
  constructor(
    @Inject(IAgentTurnPort) private readonly agentTurn: IAgentTurnPort,
    private readonly events: WebConversationEventsService,
    private readonly entries: ConversationEntryService,
  ) {}

  async execute(conversationId: string): Promise<void> {
    if (!await this.agentTurn.cancelTurn(conversationId)) {
      await this.events.publishEntry(conversationId, this.entries.notice('info', 'There is no running task to cancel.'));
    }
  }
}
