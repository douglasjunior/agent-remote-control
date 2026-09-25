import { beforeEach, describe, expect, it } from 'vitest';

import { InMemorySessionStoreAdapter } from '../adapters/in-memory-session-store.adapter.js';
import type { SessionContext } from '../models/session-context.model.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { CancelAgentTurnUseCase } from './cancel-agent-turn.use-case.js';


describe('CancelAgentTurnUseCase', () => {
  let useCase: CancelAgentTurnUseCase;
  let stubAgentPort: StubAgentPort;
  let sessionStore: InMemorySessionStoreAdapter;

  beforeEach(() => {
    stubAgentPort = new StubAgentPort();
    sessionStore = new InMemorySessionStoreAdapter();
    useCase = new CancelAgentTurnUseCase(stubAgentPort, sessionStore);
  });

  it('should call agentPort.cancel when session is found', async () => {
    const session: SessionContext = {
      sessionId: 'sess-cancel-1',
      channelId: 'ch-cancel-1',
      userId: 'user-1',
      workspacePath: '/repo/workspace',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await sessionStore.saveSession(session);

    await useCase.execute('ch-cancel-1');

    expect(stubAgentPort.cancelCalls).toBe(1);
  });

  it('should call agentPort.cancel when session with threadId is found', async () => {
    const session: SessionContext = {
      sessionId: 'sess-cancel-2',
      channelId: 'ch-cancel-2',
      threadId: 'th-cancel-2',
      userId: 'user-1',
      workspacePath: '/repo/workspace',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await sessionStore.saveSession(session);

    await useCase.execute('ch-cancel-2', 'th-cancel-2');

    expect(stubAgentPort.cancelCalls).toBe(1);
  });

  it('should do nothing when session is not found', async () => {
    await useCase.execute('ch-unknown');

    expect(stubAgentPort.cancelCalls).toBe(0);
  });
});
