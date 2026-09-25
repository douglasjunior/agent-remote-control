import { Injectable, Logger } from '@nestjs/common';

import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';
import { buildConversationKey } from '../utils/conversation-key.util.js';


@Injectable()
export class CancelAgentTurnUseCase {
  private readonly logger = new Logger(CancelAgentTurnUseCase.name);

  constructor(
    private readonly conversationRuntime: ConversationRuntimeService,
  ) {}

  async execute(channelId: string, threadId?: string): Promise<boolean> {
    const conversationKey = buildConversationKey(channelId, threadId);
    this.logger.log(`[Cancel Requested] Conversation=${conversationKey}`);

    try {
      const cancelled = await this.conversationRuntime.cancel(conversationKey);
      if (cancelled) {
        this.logger.log(`[Cancel Signal Sent] Conversation=${conversationKey}`);
      } else {
        this.logger.warn(`[Cancel Ignored] No turn in progress for conversation=${conversationKey}`);
      }
      return cancelled;
    } catch (error) {
      this.logger.error(
        `[Cancel Failed] Error sending cancel signal for conversation=${conversationKey}: ${error}`,
      );
      throw error;
    }
  }
}
