import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';

import type { RetryPolicy } from '../utils/retry-delay.util.js';

import { RetryBudget } from './retry-budget.model.js';


const SECOND = 1000;

describe('RetryBudget', () => {
  const policy: RetryPolicy = { baseDelayMs: 15 * SECOND, maxDelayMs: 60 * SECOND, maxTotalMs: 100 * SECOND };

  beforeEach(() => {
    rs.useFakeTimers();
    rs.setSystemTime(1_000_000);
  });

  afterEach(() => {
    rs.useRealTimers();
  });

  it('should wait twice as long after each retry', () => {
    const budget = new RetryBudget();

    const first = budget.next(policy);
    const second = budget.next(policy);

    expect(first).toEqual({ attempt: 1, delayMs: 15_000 });
    expect(second).toEqual({ attempt: 2, delayMs: 30_000 });
  });

  it('should cut the last wait to the time that is left, then give up', () => {
    const budget = new RetryBudget();
    budget.next(policy);
    rs.advanceTimersByTime(15 * SECOND);
    budget.next(policy);
    rs.advanceTimersByTime(30 * SECOND);

    const last = budget.next(policy);
    rs.advanceTimersByTime(55 * SECOND);

    expect(last).toEqual({ attempt: 3, delayMs: 55_000 });
    expect(budget.next(policy)).toBeUndefined();
  });

  it('should allow no retry when the policy disables them', () => {
    expect(new RetryBudget().next({ ...policy, maxTotalMs: 0 })).toBeUndefined();
  });
});
