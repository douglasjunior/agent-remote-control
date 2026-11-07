import { afterEach, describe, expect, it } from 'vitest';

import { AgentAuthConfigService } from './agent-auth-config.service.js';


describe('AgentAuthConfigService', () => {
  afterEach(() => {
    delete process.env.AGENT_AUTH_ENABLED;
    delete process.env.AGENT_AUTH_LOGIN_TIMEOUT_MS;
    delete process.env.AGENT_AUTH_STATUS_TIMEOUT_MS;
  });

  it('should be enabled and use the defaults without configuration', () => {
    const config = new AgentAuthConfigService();

    expect(config.isEnabled()).toBe(true);
    expect(config.getLoginTimeoutMs()).toBe(900_000);
    expect(config.getStatusTimeoutMs()).toBe(10_000);
  });

  it('should be disabled by AGENT_AUTH_ENABLED=false in any case', () => {
    process.env.AGENT_AUTH_ENABLED = ' False ';

    expect(new AgentAuthConfigService().isEnabled()).toBe(false);
  });

  it('should read the timeouts from the environment', () => {
    process.env.AGENT_AUTH_LOGIN_TIMEOUT_MS = '1000';
    process.env.AGENT_AUTH_STATUS_TIMEOUT_MS = '2000';
    const config = new AgentAuthConfigService();

    expect(config.getLoginTimeoutMs()).toBe(1000);
    expect(config.getStatusTimeoutMs()).toBe(2000);
  });

  it('should ignore a timeout that is not a positive number', () => {
    process.env.AGENT_AUTH_LOGIN_TIMEOUT_MS = 'soon';

    expect(new AgentAuthConfigService().getLoginTimeoutMs()).toBe(900_000);
  });
});
