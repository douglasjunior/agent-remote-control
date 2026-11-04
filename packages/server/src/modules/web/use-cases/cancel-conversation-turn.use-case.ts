import { Inject, Injectable } from '@nestjs/common';

import { IAgentTurnPort } from '../../orchestrator/ports/agent-turn.port.js';
import { WebConversationEventsService } from '../services/web-conversation-events.service.js';
import { noticeEntry } from '../utils/conversation-entry.util.js';


@Injectable()
export class CancelConversationTurnUseCase {
  constructor(
    @Inject(IAgentTurnPort) private readonly agentTurn: IAgentTurnPort,
    private readonly events: WebConversationEventsService,
  ) {}

  async execute(conversationId: string): Promise<void> {
    if (!await this.agentTurn.cancelTurn(conversationId)) {
      await this.events.publishEntry(conversationId, noticeEntry('info', 'There is no running task to cancel.'));
    }
  }
}
