import { afterEach, describe, expect, it, rs } from '@rstest/core';

import { AgentToolsConfigService } from './agent-tools-config.service.js';


describe('AgentToolsConfigService', () => {
  afterEach(() => {
    rs.unstubAllEnvs();
  });

  it('should be enabled by default', () => {
    rs.stubEnv('AGENT_MCP_ENABLED', undefined);

    expect(new AgentToolsConfigService().isEnabled()).toBe(true);
  });

  it('should be disabled only by the value false', () => {
    const config = new AgentToolsConfigService();

    rs.stubEnv('AGENT_MCP_ENABLED', ' FALSE ');
    expect(config.isEnabled()).toBe(false);
    rs.stubEnv('AGENT_MCP_ENABLED', '0');
    expect(config.isEnabled()).toBe(true);
  });
});
