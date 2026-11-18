import { describe, expect, it } from '@rstest/core';

import { AgentAuthRequiredError, AgentBinaryNotFoundError, PromptCancelledError } from '../../agent/ports/agent.port.js';

import { isRetryableAgentError } from './retryable-agent-error.util.js';


describe('isRetryableAgentError', () => {
  it.each([
    ['an error of the transport', new Error('connection lost')],
    ['a value that is not an Error', 'raw failure'],
  ])('should retry %s', (_name, error) => {
    expect(isRetryableAgentError(error)).toBe(true);
  });

  it.each([
    ['a cancellation', new PromptCancelledError()],
    ['a missing login', new AgentAuthRequiredError('agy', 'Login needed')],
    ['a missing CLI', new AgentBinaryNotFoundError('agy', 'ENOENT')],
  ])('should not retry %s', (_name, error) => {
    expect(isRetryableAgentError(error)).toBe(false);
  });
});
