import { Inject, Injectable } from '@nestjs/common';

import { ITurnRetryPort } from '../../orchestrator/ports/turn-retry.port.js';
import { WebConversationEventsService } from '../services/web-conversation-events.service.js';


@Injectable()
export class RetryConversationTurnUseCase {
  constructor(
    @Inject(ITurnRetryPort) private readonly turnRetry: ITurnRetryPort,
    private readonly events: WebConversationEventsService,
  ) {}

  /** Retries the failed turn without waiting for the countdown. Returns false when no retry is waiting. */
  now(conversationId: string): Promise<boolean> {
    return this.settle(conversationId, this.turnRetry.retryNow(conversationId));
  }

  /** Ends the retries, so the error stands. Returns false when no retry is waiting. */
  stop(conversationId: string): Promise<boolean> {
    return this.settle(conversationId, this.turnRetry.stopRetrying(conversationId));
  }

  /** A card still showing a retry nothing waits for, such as one an earlier server process left, is closed. */
  private async settle(conversationId: string, done: boolean): Promise<boolean> {
    if (!done) {
      await this.events.settleOrphanedRetries(conversationId);
    }
    return done;
  }
}
