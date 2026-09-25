import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildSessionContext } from '../testing/session-context.fixture.js';

import { JsonSessionStoreAdapter } from './json-session-store.adapter.js';


describe('JsonSessionStoreAdapter', () => {
  let rootDir: string;
  let dataDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'json-session-store-'));
    dataDir = join(rootDir, 'data');
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('should return null when the file does not exist', async () => {
    const store = new JsonSessionStoreAdapter(dataDir);

    await expect(store.findSession('ch-1')).resolves.toBeNull();
  });

  it('should persist sessions and rehydrate dates in a new instance', async () => {
    const session = buildSessionContext({ agentSessionId: 'conv-1' });
    await new JsonSessionStoreAdapter(dataDir).saveSession(session);

    const reloaded = await new JsonSessionStoreAdapter(dataDir).findSession('ch-1');

    expect(reloaded).toEqual(session);
    expect(reloaded?.createdAt).toBeInstanceOf(Date);
    expect(JSON.parse(readFileSync(join(dataDir, 'sessions.json'), 'utf-8'))).toHaveLength(1);
  });

  it('should distinguish sessions with and without thread', async () => {
    const store = new JsonSessionStoreAdapter(dataDir);
    await store.saveSession(buildSessionContext({ sessionId: 'main' }));
    await store.saveSession(buildSessionContext({ sessionId: 'thread', threadId: 'th-1' }));

    expect((await store.findSession('ch-1'))?.sessionId).toBe('main');
    expect((await store.findSession('ch-1', 'th-1'))?.sessionId).toBe('thread');
    await expect(store.findSession('ch-1', 'th-2')).resolves.toBeNull();
  });

  it('should replace a session saved again with the same id', async () => {
    const store = new JsonSessionStoreAdapter(dataDir);
    await store.saveSession(buildSessionContext());
    await store.saveSession(buildSessionContext({ agentSessionId: 'conv-2' }));

    const reloaded = await new JsonSessionStoreAdapter(dataDir).findSession('ch-1');

    expect(reloaded?.agentSessionId).toBe('conv-2');
  });

  it('should keep every session saved concurrently', async () => {
    const store = new JsonSessionStoreAdapter(dataDir);

    await Promise.all([
      store.saveSession(buildSessionContext({ sessionId: 'a', channelId: 'ch-a' })),
      store.saveSession(buildSessionContext({ sessionId: 'b', channelId: 'ch-b' })),
    ]);

    const reloaded = new JsonSessionStoreAdapter(dataDir);
    expect((await reloaded.findSession('ch-a'))?.sessionId).toBe('a');
    expect((await reloaded.findSession('ch-b'))?.sessionId).toBe('b');
  });

  it('should keep saving after a failed write', async () => {
    writeFileSync(dataDir, 'not a directory');
    const store = new JsonSessionStoreAdapter(dataDir);

    await expect(store.saveSession(buildSessionContext())).rejects.toThrow();

    rmSync(dataDir);
    await store.saveSession(buildSessionContext({ agentSessionId: 'conv-1' }));
    const reloaded = await new JsonSessionStoreAdapter(dataDir).findSession('ch-1');
    expect(reloaded?.agentSessionId).toBe('conv-1');
  });

  it('should treat an invalid file as empty', async () => {
    const store = new JsonSessionStoreAdapter(rootDir);
    writeFileSync(join(rootDir, 'sessions.json'), '{not json');

    await expect(store.findSession('ch-1')).resolves.toBeNull();
  });
});
