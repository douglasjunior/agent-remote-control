import { Injectable, Logger } from '@nestjs/common';

import { PromptCancelledError } from '../../agent/ports/agent.port.js';
import { Countdown } from '../models/countdown.model.js';
import type { RetryDecision, RetryListener, RetryMessage, RetryPrompt, RetryReason } from '../models/turn-retry.model.js';
import type { ITurnRetryPort } from '../ports/turn-retry.port.js';
import { buildAttachmentsPrompt } from '../prompts/attachments.prompt.js';


type PendingRetry = {
  readonly countdown: Countdown;
  readonly listener: RetryListener;
  readonly resolve: (decision: RetryDecision) => void;
  readonly reject: (error: Error) => void;
};

/**
 * The failed rounds of the CEO that wait to be tried again, per conversation. A wait ends when its countdown
 * does, when the user asks for the retry now or to stop retrying, or when the turn is cancelled.
 */
@Injectable()
export class TurnRetryService implements ITurnRetryPort {
  private readonly logger = new Logger(TurnRetryService.name);
  private readonly pending = new Map<string, Set<PendingRetry>>();

  /** Resolves once the wait ends. `listener.scheduled` shows it, with the time the retry happens at. */
  wait(
    conversationKey: string,
    { roleName, errorMessage, attempt }: Omit<RetryPrompt, 'timeout'>,
    delayMs: number,
    listener: RetryListener,
  ): Promise<RetryDecision> {
    return new Promise((resolve, reject) => {
      const retry: PendingRetry = { countdown: new Countdown(), listener, resolve, reject };
      const waiting = this.pending.get(conversationKey) ?? new Set();
      waiting.add(retry);
      this.pending.set(conversationKey, waiting);
      const timeout = retry.countdown.start(delayMs, () => this.end(conversationKey, retry, 'elapsed', () => resolve({ kind: 'retry' })));
      this.logger.log(`[Retry Waiting] Conversation=${conversationKey}, Role=${roleName}, Attempt=${attempt}, DelayMs=${delayMs}`);
      listener.scheduled({ roleName, errorMessage, attempt, timeout });
    });
  }

  hasPendingRetry(conversationId: string): boolean {
    return this.pending.has(conversationId);
  }

  retryNow(conversationId: string, message?: RetryMessage): boolean {
    const userMessage = message && buildAttachmentsPrompt(message.text.trim(), message.attachments).trim();
    return this.endAll(conversationId, 'requested', retry => retry.resolve({ kind: 'retry', ...(userMessage ? { message: userMessage } : {}) }));
  }

  stopRetrying(conversationId: string): boolean {
    return this.endAll(conversationId, 'stopped', retry => retry.resolve({ kind: 'stop' }));
  }

  /** Rejects every wait with a cancellation, so the turns waiting on them end as cancelled. */
  cancel(conversationId: string): boolean {
    return this.endAll(conversationId, 'cancelled', retry => retry.reject(new PromptCancelledError()));
  }

  private endAll(conversationKey: string, reason: RetryReason, settle: (retry: PendingRetry) => void): boolean {
    const waiting = [...this.pending.get(conversationKey) ?? []];
    for (const retry of waiting) {
      this.end(conversationKey, retry, reason, () => settle(retry));
    }
    return waiting.length > 0;
  }

  private end(conversationKey: string, retry: PendingRetry, reason: RetryReason, settle: () => void): void {
    retry.countdown.stop();
    const waiting = this.pending.get(conversationKey);
    waiting?.delete(retry);
    if (waiting?.size === 0) {
      this.pending.delete(conversationKey);
    }
    this.logger.log(`[Retry Ended] Conversation=${conversationKey}, Reason=${reason}`);
    settle();
    retry.listener.ended(reason);
  }
}
