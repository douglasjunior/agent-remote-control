import { afterEach, describe, expect, it } from '@rstest/core';

import { AgentRetryConfigService } from './agent-retry-config.service.js';


describe('AgentRetryConfigService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should default to three retries, the first after fifteen seconds', () => {
    delete process.env.AGENT_MAX_RETRIES;
    delete process.env.AGENT_RETRY_DELAY_MS;

    expect(new AgentRetryConfigService().getPolicy()).toEqual({ maxRetries: 3, baseDelayMs: 15_000 });
  });

  it('should read both values from the environment', () => {
    process.env.AGENT_MAX_RETRIES = '5';
    process.env.AGENT_RETRY_DELAY_MS = ' 2000 ';

    expect(new AgentRetryConfigService().getPolicy()).toEqual({ maxRetries: 5, baseDelayMs: 2000 });
  });

  it('should allow zero retries to disable them', () => {
    process.env.AGENT_MAX_RETRIES = '0';

    expect(new AgentRetryConfigService().getPolicy().maxRetries).toBe(0);
  });

  it.each(['abc', '-1', 'Infinity'])('should fall back to the defaults for %s', (value) => {
    process.env.AGENT_MAX_RETRIES = value;
    process.env.AGENT_RETRY_DELAY_MS = value;

    expect(new AgentRetryConfigService().getPolicy()).toEqual({ maxRetries: 3, baseDelayMs: 15_000 });
  });
});
