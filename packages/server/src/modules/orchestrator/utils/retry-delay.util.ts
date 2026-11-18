export type RetryPolicy = {
  /** The wait before the first retry; each one after it waits twice as long as the one before. */
  readonly baseDelayMs: number;
  /** The longest a single wait gets. */
  readonly maxDelayMs: number;
  /** How long after the first failure the retries last. Any of the three at `0` disables them. */
  readonly maxTotalMs: number;
};

/**
 * The wait before retry number `attempt` (from 1), after `elapsedMs` since the first failure; the last wait is cut
 * to what is left of `maxTotalMs`. `undefined` when the retries are disabled or what is left is shorter than
 * `baseDelayMs`, which would only flash a retry the user cannot act on.
 */
export function nextRetryDelay({ baseDelayMs, maxDelayMs, maxTotalMs }: RetryPolicy, attempt: number, elapsedMs: number): number | undefined {
  const remainingMs = maxTotalMs - elapsedMs;
  if (baseDelayMs <= 0 || maxDelayMs <= 0 || remainingMs < baseDelayMs) {
    return undefined;
  }
  return Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs, remainingMs);
}
