import { Inject, Injectable, Logger } from '@nestjs/common';

import type { TurnRequest } from '../models/turn-request.model.js';
import type { RetryNote } from '../models/turn-retry.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { TurnRetryConfigService } from '../services/turn-retry-config.service.js';
import { TurnRetryService } from '../services/turn-retry.service.js';
import { isPromptCancellation } from '../utils/prompt-cancellation.util.js';
import { nextRetryDelay } from '../utils/retry-delay.util.js';


type Attempt<T> =
  | { readonly kind: 'done'; readonly outcome: T }
  /** `give` hands back the failure the way it came: the outcome that was refused, or the error that was thrown. */
  | { readonly kind: 'failed'; readonly message: string; readonly give: () => T };

/**
 * Runs a round of the CEO and, when it fails, shows the failure to the user and tries the round again after a
 * wait that doubles each time, like a question waits for an answer. The user can ask for the retry now or end
 * the retries; once they end, or their time is spent, the failure comes out as it came.
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
   * `run` is one attempt, with the note of the failure it follows on a retry. A thrown error fails the attempt, and
   * so does an outcome `failureOf` describes; a cancellation is never retried.
   */
  async execute<T>(
    request: TurnRequest,
    run: (retry: RetryNote | undefined) => Promise<T>,
    failureOf: (outcome: T) => string | undefined,
  ): Promise<T> {
    const policy = this.retryConfig.getPolicy();
    const roleName = this.agentRegistry.getDisplayName(request.agentRole);
    let firstFailureAt: number | undefined;
    let retry: RetryNote | undefined;

    for (let attempt = 1; ; attempt++) {
      const result = await this.attempt(run, retry, failureOf);
      if (result.kind === 'done') {
        return result.outcome;
      }
      firstFailureAt ??= Date.now();
      const delayMs = nextRetryDelay(policy, attempt, Date.now() - firstFailureAt);
      if (delayMs === undefined) {
        return result.give();
      }

      this.logger.warn(`[Retry Scheduled] Conversation=${request.conversationId}, Role=${request.agentRole}, Attempt=${attempt}: ${result.message}`);
      request.onDraft?.('');
      const decision = await this.turnRetry.wait(
        request.conversationId,
        { roleName, errorMessage: result.message, attempt },
        delayMs,
        {
          scheduled: prompt => request.onRetry?.({ kind: 'scheduled', prompt }),
          ended: reason => request.onRetry?.({ kind: 'ended', reason }),
        },
      );
      if (decision.kind === 'stop') {
        return result.give();
      }
      retry = { errorMessage: result.message, ...(decision.message ? { userMessage: decision.message } : {}) };
    }
  }

  private async attempt<T>(
    run: (retry: RetryNote | undefined) => Promise<T>,
    retry: RetryNote | undefined,
    failureOf: (outcome: T) => string | undefined,
  ): Promise<Attempt<T>> {
    try {
      const outcome = await run(retry);
      const message = failureOf(outcome);
      return message === undefined ? { kind: 'done', outcome } : { kind: 'failed', message, give: () => outcome };
    } catch (error) {
      if (isPromptCancellation(error)) {
        throw error;
      }
      return {
        kind: 'failed',
        message: error instanceof Error ? error.message : String(error),
        give: () => {
          throw error;
        },
      };
    }
  }
}
