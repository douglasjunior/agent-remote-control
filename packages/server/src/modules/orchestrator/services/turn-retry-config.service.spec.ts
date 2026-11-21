import { describe, expect, it } from '@rstest/core';

import { StubRuntimeSettings } from '../../settings/testing/stub-runtime-settings.js';

import { TurnRetryConfigService } from './turn-retry-config.service.js';


describe('TurnRetryConfigService', () => {
  it('should default to a first retry after fifteen seconds, waits of at most two hours and five hours in all', () => {
    expect(new TurnRetryConfigService(new StubRuntimeSettings()).getPolicy()).toEqual({ baseDelayMs: 15_000, maxDelayMs: 7_200_000, maxTotalMs: 18_000_000 });
  });

  it('should read the three values from the settings', () => {
    const settings = new StubRuntimeSettings({ TURN_RETRY_BASE_DELAY_MS: 1000, TURN_RETRY_MAX_DELAY_MS: 60_000, TURN_RETRY_MAX_TOTAL_MS: 0 });

    expect(new TurnRetryConfigService(settings).getPolicy()).toEqual({ baseDelayMs: 1000, maxDelayMs: 60_000, maxTotalMs: 0 });
  });
});
