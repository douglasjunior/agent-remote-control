import { describe, expect, it } from '@rstest/core';

import { nextRetryDelay, type RetryPolicy } from './retry-delay.util.js';


const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const policy: RetryPolicy = { baseDelayMs: 15_000, maxDelayMs: 2 * HOUR, maxTotalMs: 5 * HOUR };

describe('nextRetryDelay', () => {
  it('should double the wait at each retry, starting from the base', () => {
    const waits = [1, 2, 3, 4, 5].map(attempt => nextRetryDelay(policy, attempt, 0));

    expect(waits).toEqual([15_000, 30_000, 60_000, 120_000, 240_000]);
  });

  it('should never wait longer than the maximum of a single wait', () => {
    expect(nextRetryDelay(policy, 12, HOUR)).toBe(2 * HOUR);
  });

  it('should cut the last wait to the time that is left', () => {
    expect(nextRetryDelay(policy, 12, 4 * HOUR + 40 * MINUTE)).toBe(20 * MINUTE);
  });

  it('should stop once the time is spent', () => {
    expect(nextRetryDelay(policy, 3, 5 * HOUR)).toBeUndefined();
    expect(nextRetryDelay(policy, 3, 6 * HOUR)).toBeUndefined();
  });

  it.each([
    ['the base wait', { ...policy, baseDelayMs: 0 }],
    ['the longest wait', { ...policy, maxDelayMs: 0 }],
    ['the total time', { ...policy, maxTotalMs: 0 }],
  ])('should disable the retries when %s is zero', (_name, disabled) => {
    expect(nextRetryDelay(disabled, 1, 0)).toBeUndefined();
  });
});
