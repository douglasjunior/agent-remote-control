import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { createNodeLockedFiles } from '../../storage/testing/node-locked-files.js';
import type { AgentSession } from '../models/agent-session.model.js';
import type { SessionContext } from '../models/session-context.model.js';
import { buildSessionContext } from '../testing/session-context.fixture.js';

import { JsonSessionStoreAdapter } from './json-session-store.adapter.js';


const createStore = (dataDir: string) => new JsonSessionStoreAdapter(dataDirectoryAt(dataDir), createNodeLockedFiles());
const save = (store: JsonSessionStoreAdapter, session: SessionContext) => store.updateSession(session.conversationId, () => session);
const binding = (role: string): AgentSession => ({ role, agentId: 'claude', sessionId: `${role}-session`, projectName: 'app', artifactId: null });

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
    const store = createStore(dataDir);

    await expect(store.findSession('conv-1')).resolves.toBeNull();
  });

  it('should persist sessions as a map keyed by conversation id and reload them in a new instance', async () => {
    const session = buildSessionContext({ agentSessions: [{ role: 'CEO', agentId: 'claude', sessionId: 'conv-1', projectName: null, artifactId: null }] });
    await save(createStore(dataDir), session);

    const reloaded = await createStore(dataDir).findSession('conv-1');

    expect(reloaded).toEqual(session);
    expect(JSON.parse(readFileSync(join(dataDir, 'sessions.json'), 'utf-8'))).toEqual({
      'conv-1': { agentSessions: [{ role: 'CEO', agentId: 'claude', sessionId: 'conv-1', projectName: null, artifactId: null }] },
    });
  });

  it('should keep sessions of different conversations apart', async () => {
    const store = createStore(dataDir);
    await save(store, buildSessionContext({ agentSessions: [{ role: 'CEO', agentId: 'claude', sessionId: 'conv-1', projectName: null, artifactId: null }] }));
    await save(store, buildSessionContext({ conversationId: 'conv-th-1' }));

    expect((await store.findSession('conv-1'))?.agentSessions).toHaveLength(1);
    expect((await store.findSession('conv-th-1'))?.agentSessions).toEqual([]);
    await expect(store.findSession('conv-th-2')).resolves.toBeNull();
  });

  it('should replace a session saved again for the same conversation', async () => {
    const store = createStore(dataDir);
    await save(store, buildSessionContext());
    await save(store, buildSessionContext({ agentSessions: [{ role: 'CEO', agentId: 'claude', sessionId: 'conv-2', projectName: null, artifactId: null }] }));

    const reloaded = await createStore(dataDir).findSession('conv-1');

    expect(reloaded?.agentSessions).toEqual([{ role: 'CEO', agentId: 'claude', sessionId: 'conv-2', projectName: null, artifactId: null }]);
  });

  it('should keep every session saved concurrently', async () => {
    const store = createStore(dataDir);

    await Promise.all([
      save(store, buildSessionContext({ conversationId: 'conv-a' })),
      save(store, buildSessionContext({ conversationId: 'conv-b' })),
    ]);

    const reloaded = createStore(dataDir);
    expect((await reloaded.findSession('conv-a'))?.conversationId).toBe('conv-a');
    expect((await reloaded.findSession('conv-b'))?.conversationId).toBe('conv-b');
  });

  it('should hand an update the stored session, an empty one when there is none, and store nothing when it returns undefined', async () => {
    const store = createStore(dataDir);
    const seen: SessionContext[] = [];

    await expect(store.updateSession('conv-1', (session) => {
      seen.push(session);
      return undefined;
    })).resolves.toEqual({ conversationId: 'conv-1', agentSessions: [] });

    expect(seen).toEqual([{ conversationId: 'conv-1', agentSessions: [] }]);
    await expect(store.findSession('conv-1')).resolves.toBeNull();
  });

  it('should keep the bindings that concurrent updates add to one conversation, from this process and another', async () => {
    const store = createStore(dataDir);
    const otherProcess = createStore(dataDir);
    const roles = ['CEO', 'DEVELOPER', 'QA', 'TECH_LEAD'];

    await Promise.all(roles.map((role, index) => (index % 2 === 0 ? store : otherProcess).updateSession('conv-1', session => ({
      ...session,
      agentSessions: [...session.agentSessions, binding(role)],
    }))));

    const reloaded = await createStore(dataDir).findSession('conv-1');
    expect(reloaded?.agentSessions.map(agentSession => agentSession.role).sort()).toEqual(roles);
    expect(readdirSync(dataDir)).toEqual(['sessions.json']);
  });

  it('should keep saving after a failed write', async () => {
    writeFileSync(dataDir, 'not a directory');
    const store = createStore(dataDir);

    await expect(save(store, buildSessionContext())).rejects.toThrow();

    rmSync(dataDir);
    await save(store, buildSessionContext({ agentSessions: [{ role: 'CEO', agentId: 'claude', sessionId: 'conv-1', projectName: null, artifactId: null }] }));
    const reloaded = await createStore(dataDir).findSession('conv-1');
    expect(reloaded?.agentSessions).toEqual([{ role: 'CEO', agentId: 'claude', sessionId: 'conv-1', projectName: null, artifactId: null }]);
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

    const reloaded = await createStore(rootDir).findSession('conv-1');

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

    const reloaded = await createStore(rootDir).findSession('conv-1');

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

    const reloaded = await createStore(rootDir).findSession('conv-1');

    expect(reloaded?.agentSessions).toEqual([
      { role: 'CEO', agentId: 'claude', sessionId: 'conv-1', projectName: null, artifactId: null },
      { role: 'DEVELOPER', agentId: 'claude', sessionId: 'dev-1', projectName: 'my-app', artifactId: null },
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
    const store = createStore(rootDir);

    expect((await store.findSession('ch:th'))?.agentSessions).toEqual([]);
    expect((await store.findSession('dm'))?.agentSessions).toEqual([]);
    expect((await store.findSession(''))?.agentSessions).toEqual([]);
  });

  it.each([['invalid JSON', '{not json'], ['null', 'null'], ['a null entry', '{"conv-1": null}']])('should treat %s as empty', async (_label, content) => {
    const store = createStore(rootDir);
    writeFileSync(join(rootDir, 'sessions.json'), content);

    await expect(store.findSession('conv-1')).resolves.toBeNull();
  });

  it('should read the array format, drop the removed fields and write the map format on the next save', async () => {
    const legacyAgentSession = { role: 'CEO', agentId: 'claude', sessionId: 'acp-old', projectName: null };
    const legacy = {
      userId: 'user-1',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    writeFileSync(join(rootDir, 'sessions.json'), JSON.stringify([
      { ...legacy, sessionId: 'a', conversationId: 'conv-1', agentSessions: [legacyAgentSession] },
      { ...legacy, sessionId: 'b', channelId: 'ch', threadId: 'th', agentSessions: [legacyAgentSession] },
    ]));
    const store = createStore(rootDir);

    const loaded = await store.findSession('conv-1');
    const migrated = { ...legacyAgentSession, artifactId: null };
    expect(loaded).toEqual({ conversationId: 'conv-1', agentSessions: [migrated] });

    await save(store, buildSessionContext({ conversationId: 'conv-2' }));

    expect(JSON.parse(readFileSync(join(rootDir, 'sessions.json'), 'utf-8'))).toEqual({
      'conv-1': { agentSessions: [migrated] },
      'ch:th': { agentSessions: [migrated] },
      'conv-2': { agentSessions: [] },
    });
  });

  it('should keep the later item when legacy items share a conversation id', async () => {
    const item = { conversationId: 'conv-1', userId: 'user-1', workspacePath: '/w', agentRole: 'CEO', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    writeFileSync(join(rootDir, 'sessions.json'), JSON.stringify([
      { ...item, sessionId: 'a', agentSessions: [] },
      { ...item, sessionId: 'b', agentSessions: [{ role: 'CEO', agentId: 'claude', sessionId: 'acp-2' }] },
    ]));

    const loaded = await createStore(rootDir).findSession('conv-1');

    expect(loaded?.agentSessions).toEqual([{ role: 'CEO', agentId: 'claude', sessionId: 'acp-2', projectName: null, artifactId: null }]);
  });

  it('should keep the task of an agent session and read one stored without it as a session without a task', async () => {
    writeFileSync(join(rootDir, 'sessions.json'), JSON.stringify({
      'conv-1': {
        agentSessions: [
          { role: 'DEVELOPER', agentId: 'claude', sessionId: 'dev-project', projectName: 'my-app' },
          { role: 'DEVELOPER', agentId: 'claude', sessionId: 'dev-t1', projectName: 'my-app', artifactId: 'T-1' },
        ],
      },
    }));

    const loaded = await createStore(rootDir).findSession('conv-1');

    expect(loaded?.agentSessions).toEqual([
      { role: 'DEVELOPER', agentId: 'claude', sessionId: 'dev-project', projectName: 'my-app', artifactId: null },
      { role: 'DEVELOPER', agentId: 'claude', sessionId: 'dev-t1', projectName: 'my-app', artifactId: 'T-1' },
    ]);
  });
});
