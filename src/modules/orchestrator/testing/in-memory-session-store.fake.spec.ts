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
    const result = await store.findSession('ch-1');
    expect(result).toBeNull();
  });

  it('should save and find session by channelId without threadId', async () => {
    const session: SessionContext = buildSessionContext({
      sessionId: 'sess-1',
      channelId: 'ch-1',
      userId: 'usr-1',
      workspacePath: '/path/workspace',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await store.saveSession(session);
    const found = await store.findSession('ch-1');

    expect(found).toEqual(session);
  });

  it('should save and find session by channelId and threadId', async () => {
    const session: SessionContext = buildSessionContext({
      sessionId: 'sess-2',
      channelId: 'ch-1',
      threadId: 'th-1',
      userId: 'usr-1',
      workspacePath: '/path/workspace',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await store.saveSession(session);
    const found = await store.findSession('ch-1', 'th-1');

    expect(found).toEqual(session);
  });

  it('should not match session if threadId differs', async () => {
    const session: SessionContext = buildSessionContext({
      sessionId: 'sess-3',
      channelId: 'ch-1',
      threadId: 'th-1',
      userId: 'usr-1',
      workspacePath: '/path/workspace',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await store.saveSession(session);

    const foundWithoutThread = await store.findSession('ch-1');
    const foundDifferentThread = await store.findSession('ch-1', 'th-2');

    expect(foundWithoutThread).toBeNull();
    expect(foundDifferentThread).toBeNull();
  });

  it('should update existing session when saved with same sessionId', async () => {
    const initial: SessionContext = buildSessionContext({
      sessionId: 'sess-4',
      channelId: 'ch-1',
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
    const found = await store.findSession('ch-1');

    expect(found?.workspacePath).toBe('/path/new');
    expect(found?.updatedAt).toEqual(new Date('2026-01-02T00:00:00Z'));
  });
});
