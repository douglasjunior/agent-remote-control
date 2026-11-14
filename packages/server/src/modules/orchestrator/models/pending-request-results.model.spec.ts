import { describe, expect, it } from 'vitest';

import { PendingRequestResults } from './pending-request-results.model.js';


describe('PendingRequestResults', () => {
  it('delivers kept results once, at the head of the next prompt', () => {
    const pending = new PendingRequestResults();

    expect(pending.keep({ response: 'Delegating.', requestResults: '<request_results/>' })).toBe('Delegating.');
    expect(pending.before('<agent_result/>')).toBe('<request_results/>\n\n<agent_result/>');
    expect(pending.before('Next.')).toBe('Next.');
  });

  it('forgets earlier results when a response has none, and hands them over when taken', () => {
    const pending = new PendingRequestResults();

    pending.keep({ response: 'a', requestResults: 'r1' });
    pending.keep({ response: 'b' });
    expect(pending.take()).toBeUndefined();

    pending.keep({ response: 'c', requestResults: 'r2' });
    expect(pending.take()).toBe('r2');
    expect(pending.take()).toBeUndefined();
  });
});
