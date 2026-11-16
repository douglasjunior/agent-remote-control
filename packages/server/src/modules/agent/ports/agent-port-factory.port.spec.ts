import { describe, expect, it } from '@rstest/core';

import { IAgentPortFactory } from './agent-port-factory.port.js';


describe('IAgentPortFactory', () => {
  it('should define IAgentPortFactory symbol', () => {
    expect(typeof IAgentPortFactory).toBe('symbol');
    expect(IAgentPortFactory.description).toBe('IAgentPortFactory');
  });
});
