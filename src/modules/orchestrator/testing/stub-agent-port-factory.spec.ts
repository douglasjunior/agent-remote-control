import { describe, expect, it } from 'vitest';

import { StubAgentPortFactory } from './stub-agent-port-factory.js';
import { StubAgentPort } from './stub-agent.port.js';


describe('StubAgentPortFactory', () => {
  it('should expose a default agent and list it', () => {
    const factory = new StubAgentPortFactory();

    expect(factory.defaultAgentId).toBe('stub');
    expect(factory.listAgents()).toEqual([{ agentId: 'stub', displayName: 'Stub Agent' }]);
  });

  it('should count the reads of the default agent', () => {
    const factory = new StubAgentPortFactory();
    factory.defaultAgentId = 'other';

    expect(factory.defaultAgentIdReads).toBe(0);
    expect(factory.defaultAgentId).toBe('other');
    expect(factory.defaultAgentIdReads).toBe(1);
  });

  it('should treat every listed agent as available by default', () => {
    const factory = new StubAgentPortFactory();
    factory.agents = [
      { agentId: 'stub', displayName: 'Stub Agent' },
      { agentId: 'other', displayName: 'Other Agent' },
    ];

    expect(factory.listAvailableAgents()).toEqual(factory.agents);
    expect(factory.isAgentAvailable('other')).toBe(true);
  });

  it('should leave out the agents marked as unavailable', () => {
    const factory = new StubAgentPortFactory();
    factory.agents = [
      { agentId: 'stub', displayName: 'Stub Agent' },
      { agentId: 'other', displayName: 'Other Agent' },
    ];
    factory.unavailableAgentIds.add('stub');

    expect(factory.listAvailableAgents()).toEqual([{ agentId: 'other', displayName: 'Other Agent' }]);
    expect(factory.isAgentAvailable('stub')).toBe(false);
    expect(factory.listAgents()).toHaveLength(2);
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
