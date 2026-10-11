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

  it('should save and find session by conversationId without threadId', async () => {
    const session: SessionContext = buildSessionContext({
      sessionId: 'sess-1',
      conversationId: 'conv-1',
      userId: 'usr-1',
      workspacePath: '/path/workspace',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await store.saveSession(session);
    const found = await store.findSession('conv-1');

    expect(found).toEqual(session);
  });

  it('should save and find session by conversationId and threadId', async () => {
    const session: SessionContext = buildSessionContext({
      sessionId: 'sess-2',
      conversationId: 'conv-th-1',
      userId: 'usr-1',
      workspacePath: '/path/workspace',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await store.saveSession(session);
    const found = await store.findSession('conv-th-1');

    expect(found).toEqual(session);
  });

  it('should not match a different conversation id', async () => {
    const session: SessionContext = buildSessionContext({
      sessionId: 'sess-3',
      conversationId: 'conv-th-1',
      userId: 'usr-1',
      workspacePath: '/path/workspace',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await store.saveSession(session);

    const foundWithoutThread = await store.findSession('conv-1');
    const foundDifferentThread = await store.findSession('conv-th-2');

    expect(foundWithoutThread).toBeNull();
    expect(foundDifferentThread).toBeNull();
  });

  it('should update existing session when saved with same sessionId', async () => {
    const initial: SessionContext = buildSessionContext({
      sessionId: 'sess-4',
      conversationId: 'conv-1',
      userId: 'usr-1',
      workspacePath: '/path/old',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await store.saveSession(initial);

    const updated: SessionContext = {
      ...initial,
      workspacePath: '/path/new',
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    };

    await store.saveSession(updated);
    const found = await store.findSession('conv-1');

    expect(found?.workspacePath).toBe('/path/new');
    expect(found?.updatedAt).toEqual(new Date('2026-01-02T00:00:00Z'));
  });
});
