import { beforeEach, describe, expect, it } from 'vitest';

import { InMemorySessionStoreAdapter } from '../adapters/in-memory-session-store.adapter.js';
import { buildSessionContext } from '../testing/session-context.fixture.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { CancelAgentTurnUseCase } from './cancel-agent-turn.use-case.js';


describe('CancelAgentTurnUseCase', () => {
  let useCase: CancelAgentTurnUseCase;
  let stubAgentPort: StubAgentPort;
  let sessionStore: InMemorySessionStoreAdapter;

  beforeEach(() => {
    stubAgentPort = new StubAgentPort();
    sessionStore = new InMemorySessionStoreAdapter();
    useCase = new CancelAgentTurnUseCase(sessionStore);
  });

  it('should cancel the active agent port when session is found', async () => {
    await sessionStore.saveSession(
      buildSessionContext({ channelId: 'ch-cancel-1', agentPort: stubAgentPort }),
    );

    await useCase.execute('ch-cancel-1');

    expect(stubAgentPort.cancelCalls).toBe(1);
  });

  it('should cancel the active agent port when session with threadId is found', async () => {
    await sessionStore.saveSession(
      buildSessionContext({
        channelId: 'ch-cancel-2',
        threadId: 'th-cancel-2',
        agentPort: stubAgentPort,
      }),
    );

    await useCase.execute('ch-cancel-2', 'th-cancel-2');

    expect(stubAgentPort.cancelCalls).toBe(1);
  });

  it('should cancel the delegate port while a delegation is active', async () => {
    const delegatePort = new StubAgentPort();
    await sessionStore.saveSession(
      buildSessionContext({
        channelId: 'ch-cancel-3',
        agentPort: stubAgentPort,
        activeAgentPort: delegatePort,
      }),
    );

    await useCase.execute('ch-cancel-3');

    expect(delegatePort.cancelCalls).toBe(1);
    expect(stubAgentPort.cancelCalls).toBe(0);
  });

  it('should do nothing when session is not found', async () => {
    await useCase.execute('ch-unknown');

    expect(stubAgentPort.cancelCalls).toBe(0);
  });

  it('should rethrow when the agent fails to cancel', async () => {
    stubAgentPort.cancel = async () => {
      throw new Error('cancel failed');
    };
    await sessionStore.saveSession(
      buildSessionContext({ channelId: 'ch-cancel-5', agentPort: stubAgentPort }),
    );

    await expect(useCase.execute('ch-cancel-5')).rejects.toThrow('cancel failed');
  });
});
