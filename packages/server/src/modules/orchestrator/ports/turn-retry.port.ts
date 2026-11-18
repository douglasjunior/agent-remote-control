import type { RetryMessage } from '../models/turn-retry.model.js';


/** The retries of a failed turn. The channel decides how the user sees the wait and asks for it to end. */
export interface ITurnRetryPort {
  hasPendingRetry(conversationId: string): boolean;
  /** Retries now, handing the CEO the message the user wrote with it. Returns whether a retry was waiting. */
  retryNow(conversationId: string, message?: RetryMessage): boolean;
  /** Ends the retries, so the failure is the result of the turn. Returns whether a retry was waiting. */
  stopRetrying(conversationId: string): boolean;
}

export const ITurnRetryPort = Symbol('ITurnRetryPort');
