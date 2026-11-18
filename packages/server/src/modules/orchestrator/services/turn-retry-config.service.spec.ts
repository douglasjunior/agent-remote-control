import { afterEach, describe, expect, it } from '@rstest/core';

import { TurnRetryConfigService } from './turn-retry-config.service.js';


describe('TurnRetryConfigService', () => {
  const originalEnv = { ...process.env };
  const defaults = { baseDelayMs: 15_000, maxDelayMs: 7_200_000, maxTotalMs: 18_000_000 };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should default to a first retry after fifteen seconds, waits of at most two hours and five hours in all', () => {
    delete process.env.TURN_RETRY_BASE_DELAY_MS;
    delete process.env.TURN_RETRY_MAX_DELAY_MS;
    delete process.env.TURN_RETRY_MAX_TOTAL_MS;

    expect(new TurnRetryConfigService().getPolicy()).toEqual(defaults);
  });

  it('should read the three values from the environment', () => {
    process.env.TURN_RETRY_BASE_DELAY_MS = '1000';
    process.env.TURN_RETRY_MAX_DELAY_MS = ' 60000 ';
    process.env.TURN_RETRY_MAX_TOTAL_MS = '600000';

    expect(new TurnRetryConfigService().getPolicy()).toEqual({ baseDelayMs: 1000, maxDelayMs: 60_000, maxTotalMs: 600_000 });
  });

  it('should keep zero, which disables the retries', () => {
    process.env.TURN_RETRY_MAX_TOTAL_MS = '0';

    expect(new TurnRetryConfigService().getPolicy().maxTotalMs).toBe(0);
  });

  it.each(['abc', '-1', 'Infinity'])('should fall back to the defaults for %s', (value) => {
    process.env.TURN_RETRY_BASE_DELAY_MS = value;
    process.env.TURN_RETRY_MAX_DELAY_MS = value;
    process.env.TURN_RETRY_MAX_TOTAL_MS = value;

    expect(new TurnRetryConfigService().getPolicy()).toEqual(defaults);
  });
});
