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

    await expect(store.findSession('conv-1')).resolves.toBeNull();
  });

  it('should persist sessions and rehydrate dates in a new instance', async () => {
    const session = buildSessionContext({ agentSessions: [{ role: 'CEO', agentId: 'claude', sessionId: 'conv-1', projectName: null }] });
    await new JsonSessionStoreAdapter(dataDir).saveSession(session);

    const reloaded = await new JsonSessionStoreAdapter(dataDir).findSession('conv-1');

    expect(reloaded).toEqual(session);
    expect(reloaded?.createdAt).toBeInstanceOf(Date);
    expect(JSON.parse(readFileSync(join(dataDir, 'sessions.json'), 'utf-8'))).toHaveLength(1);
  });

  it('should keep sessions of different conversations apart', async () => {
    const store = new JsonSessionStoreAdapter(dataDir);
    await store.saveSession(buildSessionContext({ sessionId: 'main' }));
    await store.saveSession(buildSessionContext({ sessionId: 'thread', conversationId: 'conv-th-1' }));

    expect((await store.findSession('conv-1'))?.sessionId).toBe('main');
    expect((await store.findSession('conv-th-1'))?.sessionId).toBe('thread');
    await expect(store.findSession('conv-th-2')).resolves.toBeNull();
  });

  it('should replace a session saved again with the same id', async () => {
    const store = new JsonSessionStoreAdapter(dataDir);
    await store.saveSession(buildSessionContext());
    await store.saveSession(buildSessionContext({ agentSessions: [{ role: 'CEO', agentId: 'claude', sessionId: 'conv-2', projectName: null }] }));

    const reloaded = await new JsonSessionStoreAdapter(dataDir).findSession('conv-1');

    expect(reloaded?.agentSessions).toEqual([{ role: 'CEO', agentId: 'claude', sessionId: 'conv-2', projectName: null }]);
  });

  it('should keep every session saved concurrently', async () => {
    const store = new JsonSessionStoreAdapter(dataDir);

    await Promise.all([
      store.saveSession(buildSessionContext({ sessionId: 'a', conversationId: 'conv-a' })),
      store.saveSession(buildSessionContext({ sessionId: 'b', conversationId: 'conv-b' })),
    ]);

    const reloaded = new JsonSessionStoreAdapter(dataDir);
    expect((await reloaded.findSession('conv-a'))?.sessionId).toBe('a');
    expect((await reloaded.findSession('conv-b'))?.sessionId).toBe('b');
  });

  it('should keep saving after a failed write', async () => {
    writeFileSync(dataDir, 'not a directory');
    const store = new JsonSessionStoreAdapter(dataDir);

    await expect(store.saveSession(buildSessionContext())).rejects.toThrow();

    rmSync(dataDir);
    await store.saveSession(buildSessionContext({ agentSessions: [{ role: 'CEO', agentId: 'claude', sessionId: 'conv-1', projectName: null }] }));
    const reloaded = await new JsonSessionStoreAdapter(dataDir).findSession('conv-1');
    expect(reloaded?.agentSessions).toEqual([{ role: 'CEO', agentId: 'claude', sessionId: 'conv-1', projectName: null }]);
  });

  it('should load sessions stored without agent sessions with an empty list', async () => {
    writeFileSync(join(rootDir, 'sessions.json'), JSON.stringify([
      {
        sessionId: 'sess-1',
        conversationId: 'conv-1',
        userId: 'user-1',
        workspacePath: '/mock/workspace',
        agentRole: 'CEO',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]));

    const reloaded = await new JsonSessionStoreAdapter(rootDir).findSession('conv-1');

    expect(reloaded?.agentSessions).toEqual([]);
  });

  it('should discard agent sessions stored without agent', async () => {
    writeFileSync(join(rootDir, 'sessions.json'), JSON.stringify([
      {
        sessionId: 'sess-1',
        conversationId: 'conv-1',
        userId: 'user-1',
        workspacePath: '/mock/workspace',
        agentRole: 'CEO',
        agentSessions: [{ role: 'CEO', sessionId: 'conv-1' }],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]));

    const reloaded = await new JsonSessionStoreAdapter(rootDir).findSession('conv-1');

    expect(reloaded?.agentSessions).toEqual([]);
  });

  it('should load agent sessions stored without project as sessions at the workspaces root', async () => {
    writeFileSync(join(rootDir, 'sessions.json'), JSON.stringify([
      {
        sessionId: 'sess-1',
        conversationId: 'conv-1',
        userId: 'user-1',
        workspacePath: '/mock/workspace',
        agentRole: 'CEO',
        agentSessions: [
          { role: 'CEO', agentId: 'claude', sessionId: 'conv-1' },
          { role: 'DEVELOPER', agentId: 'claude', sessionId: 'dev-1', projectName: 'my-app' },
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]));

    const reloaded = await new JsonSessionStoreAdapter(rootDir).findSession('conv-1');

    expect(reloaded?.agentSessions).toEqual([
      { role: 'CEO', agentId: 'claude', sessionId: 'conv-1', projectName: null },
      { role: 'DEVELOPER', agentId: 'claude', sessionId: 'dev-1', projectName: 'my-app' },
    ]);
  });

  it('should derive the conversation id of sessions stored with channel and thread', async () => {
    const stored = {
      userId: 'user-1',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    writeFileSync(join(rootDir, 'sessions.json'), JSON.stringify([
      { ...stored, sessionId: 'thread', channelId: 'ch', threadId: 'th' },
      { ...stored, sessionId: 'channel', channelId: 'dm' },
      { ...stored, sessionId: 'orphan' },
    ]));
    const store = new JsonSessionStoreAdapter(rootDir);

    expect((await store.findSession('ch:th'))?.sessionId).toBe('thread');
    expect((await store.findSession('dm'))?.sessionId).toBe('channel');
    expect((await store.findSession(''))?.sessionId).toBe('orphan');
  });

  it('should treat an invalid file as empty', async () => {
    const store = new JsonSessionStoreAdapter(rootDir);
    writeFileSync(join(rootDir, 'sessions.json'), '{not json');

    await expect(store.findSession('conv-1')).resolves.toBeNull();
  });
});
