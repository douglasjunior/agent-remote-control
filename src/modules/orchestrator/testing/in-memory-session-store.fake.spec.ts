import { beforeEach, describe, expect, it } from 'vitest';

import type { SessionContext } from '../models/session-context.model.js';

import { InMemorySessionStoreFake } from './in-memory-session-store.fake.js';
import { buildSessionContext } from './session-context.fixture.js';


describe('InMemorySessionStoreFake', () => {
  let store: InMemorySessionStoreFake;

  beforeEach(() => {
    store = new InMemorySessionStoreFake();
  });

  it('should return null when session does not exist', async () => {
    const result = await store.findSession('conv-1');
    expect(result).toBeNull();
  });

  it('should save and find session by conversation id', async () => {
    const session: SessionContext = buildSessionContext({
      conversationId: 'conv-1',
    });

    await store.saveSession(session);
    const found = await store.findSession('conv-1');

    expect(found).toEqual(session);
  });

  it('should save and find session with a thread conversation id', async () => {
    const session: SessionContext = buildSessionContext({
      conversationId: 'conv-th-1',
    });

    await store.saveSession(session);
    const found = await store.findSession('conv-th-1');

    expect(found).toEqual(session);
  });

  it('should not match a different conversation id', async () => {
    const session: SessionContext = buildSessionContext({
      conversationId: 'conv-th-1',
    });

    await store.saveSession(session);

    const foundWithoutThread = await store.findSession('conv-1');
    const foundDifferentThread = await store.findSession('conv-th-2');

    expect(foundWithoutThread).toBeNull();
    expect(foundDifferentThread).toBeNull();
  });

  it('should replace the session saved again for the same conversation', async () => {
    await store.saveSession(buildSessionContext());
    const agentSessions = [{ role: 'CEO', agentId: 'stub', sessionId: 'acp-1', projectName: null }];

    await store.saveSession(buildSessionContext({ agentSessions }));

    expect((await store.findSession('conv-1'))?.agentSessions).toEqual(agentSessions);
  });
});
