import { describe, expect, it } from 'vitest';

import { PromptCancelledError } from '../../agent/ports/agent.port.js';

import { isPromptCancellation } from './prompt-cancellation.util.js';


describe('prompt-cancellation.util', () => {
  it('should recognize a cancellation by its class or its name', () => {
    const named = new Error('cancelled');
    named.name = 'PromptCancelledError';

    expect(isPromptCancellation(new PromptCancelledError())).toBe(true);
    expect(isPromptCancellation(named)).toBe(true);
  });

  it('should not take another error for a cancellation', () => {
    expect(isPromptCancellation(new Error('boom'))).toBe(false);
    expect(isPromptCancellation('PromptCancelledError')).toBe(false);
  });
});
