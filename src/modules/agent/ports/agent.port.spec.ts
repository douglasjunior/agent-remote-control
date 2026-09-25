import { describe, expect, it } from 'vitest';

import { IAgentPort, PromptCancelledError } from './agent.port.js';


describe('agent.port', () => {
  it('should instantiate PromptCancelledError with default message and name', () => {
    const error = new PromptCancelledError();

    expect(error.message).toBe('Prompt cancelled by user');
    expect(error.name).toBe('PromptCancelledError');
    expect(error).toBeInstanceOf(Error);
  });

  it('should define IAgentPort symbol for dependency injection', () => {
    expect(typeof IAgentPort).toBe('symbol');
    expect(IAgentPort.description).toBe('IAgentPort');
  });
});
