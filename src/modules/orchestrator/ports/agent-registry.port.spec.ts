import { describe, expect, it } from 'vitest';

import { IAgentRegistryPort } from './agent-registry.port.js';


describe('agent-registry.port', () => {
  it('should define IAgentRegistryPort symbol for dependency injection', () => {
    expect(typeof IAgentRegistryPort).toBe('symbol');
    expect(IAgentRegistryPort.description).toBe('IAgentRegistryPort');
  });
});
