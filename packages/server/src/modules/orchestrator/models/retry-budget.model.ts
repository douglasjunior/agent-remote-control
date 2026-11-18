import { nextRetryDelay, type RetryPolicy } from '../utils/retry-delay.util.js';


/** The retries a stretch of failures has used: the waits double from the first failure and stop once its time is spent. */
export class RetryBudget {
  private attempts = 0;
  private firstFailureAt: number | undefined;

  /** The next retry, numbered from 1 and with the wait before it; `undefined` when the policy allows no more. */
  next(policy: RetryPolicy): { readonly attempt: number; readonly delayMs: number } | undefined {
    this.firstFailureAt ??= Date.now();
    const attempt = this.attempts + 1;
    const delayMs = nextRetryDelay(policy, attempt, Date.now() - this.firstFailureAt);
    if (delayMs === undefined) {
      return undefined;
    }
    this.attempts = attempt;
    return { attempt, delayMs };
  }
}
