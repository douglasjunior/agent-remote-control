import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';

import { createWebHarness } from '../testing/web-harness.js';

import { RetryConversationTurnUseCase } from './retry-conversation-turn.use-case.js';


const at = '2026-01-01T00:00:00.000Z';
const retry: ConversationEntry = { id: 'r', at, type: 'retry', roleName: 'CEO', errorMessage: 'boom', attempt: 1, timeout: { expiresAt: 2, durationMs: 1 }, closed: false };

function setup() {
  const harness = createWebHarness();
  harness.store.seed('web-1');
  return { ...harness, useCase: new RetryConversationTurnUseCase(harness.turnRetry, harness.events) };
}

describe('RetryConversationTurnUseCase', () => {
  it('should retry now and report it when a retry is waiting', async () => {
    const { useCase, turnRetry } = setup();
    turnRetry.pending = true;

    await expect(useCase.now('web-1')).resolves.toBe(true);

    expect(turnRetry.retries).toEqual([{ conversationId: 'web-1' }]);
  });

  it('should end the retries and report it when a retry is waiting', async () => {
    const { useCase, turnRetry } = setup();
    turnRetry.pending = true;

    await expect(useCase.stop('web-1')).resolves.toBe(true);

    expect(turnRetry.stops).toEqual(['web-1']);
  });

  it.each([
    ['retrying now', (useCase: RetryConversationTurnUseCase) => useCase.now('web-1')],
    ['ending the retries', (useCase: RetryConversationTurnUseCase) => useCase.stop('web-1')],
  ])('should report that nothing waits and close a card an earlier process left open when %s', async (_name, act) => {
    const { useCase, store } = setup();
    await store.upsertEntry('web-1', retry);

    await expect(act(useCase)).resolves.toBe(false);

    expect(await store.history('web-1')).toEqual([{ ...retry, closed: true }]);
  });
});
