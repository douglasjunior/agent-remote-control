import type { RetryMessage } from '../models/turn-retry.model.js';
import type { ITurnRetryPort } from '../ports/turn-retry.port.js';


export class StubTurnRetryPort implements ITurnRetryPort {
  /** Whether the conversation has a retry waiting. */
  pending = false;

  readonly retries: { conversationId: string; message?: RetryMessage }[] = [];
  readonly stops: string[] = [];

  hasPendingRetry(): boolean {
    return this.pending;
  }

  retryNow(conversationId: string, message?: RetryMessage): boolean {
    this.retries.push({ conversationId, ...(message !== undefined ? { message } : {}) });
    return this.pending;
  }

  stopRetrying(conversationId: string): boolean {
    this.stops.push(conversationId);
    return this.pending;
  }
}
