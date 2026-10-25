import { Injectable, Logger } from '@nestjs/common';

import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';
import { UserQuestionQueueService } from '../services/user-question-queue.service.js';


@Injectable()
export class CancelAgentTurnUseCase {
  private readonly logger = new Logger(CancelAgentTurnUseCase.name);

  constructor(
    private readonly conversationRuntime: ConversationRuntimeService,
    private readonly questionQueue: UserQuestionQueueService,
  ) {}

  async execute(conversationId: string): Promise<boolean> {
    this.logger.log(`[Cancel Requested] Conversation=${conversationId}`);

    try {
      const questionsCancelled = this.questionQueue.cancel(conversationId);
      const cancelled = await this.conversationRuntime.cancel(conversationId) || questionsCancelled;
      if (cancelled) {
        this.logger.log(`[Cancel Signal Sent] Conversation=${conversationId}`);
      } else {
        this.logger.warn(`[Cancel Ignored] No turn in progress for conversation=${conversationId}`);
      }
      return cancelled;
    } catch (error) {
      this.logger.error(
        `[Cancel Failed] Error sending cancel signal for conversation=${conversationId}: ${error}`,
      );
      throw error;
    }
  }
}
