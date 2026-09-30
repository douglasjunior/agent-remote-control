import { describe, expect, it } from 'vitest';

import { StubAgentPortFactory } from './stub-agent-port-factory.js';
import { StubAgentPort } from './stub-agent.port.js';


describe('StubAgentPortFactory', () => {
  it('should expose a default agent and list it', () => {
    const factory = new StubAgentPortFactory();

    expect(factory.defaultAgentId).toBe('stub');
    expect(factory.listAgents()).toEqual([{ agentId: 'stub', displayName: 'Stub Agent' }]);
  });

  it('should create stub ports named after the requested agent and record them', () => {
    const factory = new StubAgentPortFactory();

    const port = factory.create('other');

    expect(port.agentName).toBe('other');
    expect(factory.createdAgentIds).toEqual(['other']);
  });

  it('should delegate the creation to a custom builder', () => {
    const custom = new StubAgentPort();
    const factory = new StubAgentPortFactory(() => custom);

    expect(factory.create('any')).toBe(custom);
  });
});
