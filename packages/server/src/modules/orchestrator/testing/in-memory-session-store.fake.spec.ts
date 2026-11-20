import { beforeEach, describe, expect, it } from '@rstest/core';

import { InMemorySessionStoreFake } from './in-memory-session-store.fake.js';
import { buildSessionContext } from './session-context.fixture.js';


describe('InMemorySessionStoreFake', () => {
  let store: InMemorySessionStoreFake;

  beforeEach(() => {
    store = new InMemorySessionStoreFake();
  });

  it('should return null when session does not exist', async () => {
    await expect(store.findSession('conv-1')).resolves.toBeNull();
  });

  it('should find a seeded session by conversation id only', async () => {
    const session = buildSessionContext({ conversationId: 'conv-th-1' });

    store.seed(session);

    await expect(store.findSession('conv-th-1')).resolves.toEqual(session);
    await expect(store.findSession('conv-1')).resolves.toBeNull();
  });

  it('should apply an update to the stored session, or to an empty one', async () => {
    const agentSessions = [{ role: 'CEO', agentId: 'stub', sessionId: 'acp-1', projectName: null, artifactId: null }];

    await expect(store.updateSession('conv-1', session => ({ ...session, agentSessions }))).resolves.toEqual({ conversationId: 'conv-1', agentSessions });
    await expect(store.updateSession('conv-1', session => ({ ...session, agentSessions: [...session.agentSessions, ...agentSessions] })))
      .resolves.toEqual({ conversationId: 'conv-1', agentSessions: [...agentSessions, ...agentSessions] });
  });

  it('should leave the session as it is when the update returns undefined', async () => {
    await expect(store.updateSession('conv-1', () => undefined)).resolves.toEqual({ conversationId: 'conv-1', agentSessions: [] });
    await expect(store.findSession('conv-1')).resolves.toBeNull();
  });
});
