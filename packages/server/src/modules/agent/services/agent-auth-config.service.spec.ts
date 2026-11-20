import { describe, expect, it } from '@rstest/core';

import { StubRuntimeSettings } from '../../settings/testing/stub-runtime-settings.js';

import { AgentAuthConfigService } from './agent-auth-config.service.js';


describe('AgentAuthConfigService', () => {
  it('should be enabled and use the defaults without configuration', () => {
    const config = new AgentAuthConfigService(new StubRuntimeSettings());

    expect(config.isEnabled()).toBe(true);
    expect(config.getLoginTimeoutMs()).toBe(900_000);
    expect(config.getStatusTimeoutMs()).toBe(10_000);
  });

  it('should read the flag and the timeouts from the settings', () => {
    const config = new AgentAuthConfigService(new StubRuntimeSettings({
      AGENT_AUTH_ENABLED: false,
      AGENT_AUTH_LOGIN_TIMEOUT_MS: 1000,
      AGENT_AUTH_STATUS_TIMEOUT_MS: 2000,
    }));

    expect(config.isEnabled()).toBe(false);
    expect(config.getLoginTimeoutMs()).toBe(1000);
    expect(config.getStatusTimeoutMs()).toBe(2000);
  });
});
