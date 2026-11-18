import { Inject, Injectable, Logger } from '@nestjs/common';

import { RetryBudget } from '../models/retry-budget.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { RetryMessage, RetryNote } from '../models/turn-retry.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { TurnRetryConfigService } from '../services/turn-retry-config.service.js';
import { TurnRetryService } from '../services/turn-retry.service.js';
import { isPromptCancellation } from '../utils/prompt-cancellation.util.js';


/** Turns what the user wrote to ask for a retry into the text the CEO reads, as any message of theirs becomes. */
export type PrepareRetryMessage = (message: RetryMessage) => Promise<string | undefined>;

/**
 * Retries the prompt of the CEO that failed: shows the failure to the user and sends the same prompt again after a
 * wait that doubles each time, like a question waits for an answer. The user can ask for the retry now or end the
 * retries; once they end, or their time is spent, the failure comes out as it came.
 */
@Injectable()
export class RetryCeoRoundUseCase {
  private readonly logger = new Logger(RetryCeoRoundUseCase.name);

  constructor(
    @Inject(IAgentRegistryPort) private readonly agentRegistry: IAgentRegistryPort,
    private readonly turnRetry: TurnRetryService,
    private readonly retryConfig: TurnRetryConfigService,
  ) {}

  /**
   * `run` sends the prompt, with the note of the failure it follows on a retry. A thrown error is retried; a
   * cancellation never is.
   */
  async execute<T>(
    request: TurnRequest,
    run: (retry: RetryNote | undefined) => Promise<T>,
    prepareMessage: PrepareRetryMessage,
  ): Promise<T> {
    const budget = new RetryBudget();
    let retry: RetryNote | undefined;
    for (;;) {
      try {
        return await run(retry);
      } catch (error) {
        if (isPromptCancellation(error)) {
          throw error;
        }
        retry = await this.pause(request, error instanceof Error ? error.message : String(error), budget, prepareMessage);
        if (!retry) {
          throw error;
        }
      }
    }
  }

  /**
   * Waits to try again after a failure the caller found itself, such as a response that stays invalid. The `budget`
   * is the caller's, so the waits of one stretch of failures double and end together. `undefined` when the retries
   * are over, because the user ended them or their time is spent.
   */
  async pause(
    request: TurnRequest,
    errorMessage: string,
    budget: RetryBudget,
    prepareMessage: PrepareRetryMessage,
  ): Promise<RetryNote | undefined> {
    const next = budget.next(this.retryConfig.getPolicy());
    if (!next) {
      return undefined;
    }

    const roleName = this.agentRegistry.getDisplayName(request.agentRole);
    this.logger.warn(`[Retry Scheduled] Conversation=${request.conversationId}, Role=${request.agentRole}, Attempt=${next.attempt}: ${errorMessage}`);
    request.onDraft?.('');
    const decision = await this.turnRetry.wait(
      request.conversationId,
      { roleName, errorMessage, attempt: next.attempt },
      next.delayMs,
      {
        scheduled: prompt => request.onRetry?.({ kind: 'scheduled', prompt }),
        ended: reason => request.onRetry?.({ kind: 'ended', reason }),
      },
    );
    if (decision.kind === 'stop') {
      return undefined;
    }
    const userMessage = decision.message && await prepareMessage(decision.message);
    return { errorMessage, ...(userMessage ? { userMessage } : {}) };
  }
}
