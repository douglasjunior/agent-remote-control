import { describe, expect, it } from 'vitest';

import { PromptCancelledError } from '../../agent/ports/agent.port.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { ActiveTurn } from './active-turn.model.js';


describe('ActiveTurn', () => {
  it('should cancel the currently active agent port', async () => {
    const ceo = new StubAgentPort();
    const delegate = new StubAgentPort();
    const turn = new ActiveTurn(ceo);

    turn.activate(delegate);
    await turn.cancel();

    expect(delegate.cancelCalls).toBe(1);
    expect(ceo.cancelCalls).toBe(0);
    expect(turn.isCancelled).toBe(true);
  });

  it('should throw PromptCancelledError only after cancellation', async () => {
    const turn = new ActiveTurn(new StubAgentPort());

    expect(() => turn.throwIfCancelled()).not.toThrow();
    await turn.cancel();

    expect(() => turn.throwIfCancelled()).toThrow(PromptCancelledError);
  });
});
