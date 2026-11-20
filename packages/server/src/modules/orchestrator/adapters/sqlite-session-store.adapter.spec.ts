import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

import { DATABASE_ENTITIES, DATABASE_MIGRATIONS } from '../../database/constants/database-schema.constant.js';
import { SqliteTransactionService } from '../../database/services/sqlite-transaction.service.js';
import { createInMemoryDataSource } from '../../database/testing/in-memory-data-source.js';
import type { AgentSession } from '../models/agent-session.model.js';
import type { SessionContext } from '../models/session-context.model.js';
import { buildSessionContext } from '../testing/session-context.fixture.js';

import { SqliteSessionStoreAdapter } from './sqlite-session-store.adapter.js';


const storeOver = (dataSource: DataSource) => new SqliteSessionStoreAdapter(new SqliteTransactionService(dataSource));
const save = (store: SqliteSessionStoreAdapter, session: SessionContext) => store.updateSession(session.conversationId, () => session);
const binding = (role: string): AgentSession => ({ role, agentId: 'claude', sessionId: `${role}-session`, projectName: 'app', artifactId: null });
const addBinding = (role: string) => (session: SessionContext): SessionContext => ({ ...session, agentSessions: [...session.agentSessions, binding(role)] });

describe('SqliteSessionStoreAdapter', () => {
  let dataSource: DataSource;
  let store: SqliteSessionStoreAdapter;

  beforeEach(async () => {
    dataSource = await createInMemoryDataSource();
    store = storeOver(dataSource);
  });

  afterEach(async () => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('should return null for a conversation without a stored session', async () => {
    await expect(store.findSession('conv-1')).resolves.toBeNull();
  });

  it('should read back every field of each binding, in order, and an empty session as empty', async () => {
    const session = buildSessionContext({
      agentSessions: [
        { role: 'DEVELOPER', agentId: 'claude', sessionId: 'dev-t1', projectName: 'my-app', artifactId: 'T-1', workEndedAt: '2026-01-02T00:00:00.000Z' },
        { role: 'CEO', agentId: 'agy', sessionId: 'ceo', projectName: null, artifactId: null, unanswered: true },
      ],
    });

    await expect(save(store, session)).resolves.toEqual(session);
    await save(store, buildSessionContext({ conversationId: 'conv-2' }));

    await expect(storeOver(dataSource).findSession('conv-1')).resolves.toEqual(session);
    await expect(storeOver(dataSource).findSession('conv-2')).resolves.toEqual({ conversationId: 'conv-2', agentSessions: [] });
    expect(await dataSource.query('SELECT "position", "work_ended_at", "unanswered" FROM "agent_session" ORDER BY "position"')).toEqual([
      { position: 0, work_ended_at: '2026-01-02T00:00:00.000Z', unanswered: null },
      { position: 1, work_ended_at: null, unanswered: 1 },
    ]);
  });

  it('should replace the bindings of a conversation with those of the change', async () => {
    await save(store, buildSessionContext({ agentSessions: [binding('CEO'), binding('QA')] }));

    await save(store, buildSessionContext({ agentSessions: [binding('DEVELOPER')] }));

    await expect(store.findSession('conv-1')).resolves.toEqual(buildSessionContext({ agentSessions: [binding('DEVELOPER')] }));
  });

  it('should hand an update the stored session, an empty one when there is none, and store nothing when it returns undefined', async () => {
    const seen: SessionContext[] = [];

    await expect(store.updateSession('conv-1', (session) => {
      seen.push(session);
      return undefined;
    })).resolves.toEqual({ conversationId: 'conv-1', agentSessions: [] });

    expect(seen).toEqual([{ conversationId: 'conv-1', agentSessions: [] }]);
    await expect(store.findSession('conv-1')).resolves.toBeNull();
  });

  it('should keep the bindings that interleaved updates add to one conversation', async () => {
    const roles = ['CEO', 'DEVELOPER', 'QA', 'TECH_LEAD'];

    await Promise.all(roles.map(role => store.updateSession('conv-1', addBinding(role))));

    expect((await store.findSession('conv-1'))?.agentSessions.map(session => session.role)).toEqual(roles);
  });

  it('should roll back a change the database refuses and keep what was stored', async () => {
    await save(store, buildSessionContext({ agentSessions: [binding('CEO')] }));

    await expect(store.updateSession('conv-1', session => ({ ...session, agentSessions: [{ ...binding('QA'), sessionId: null as unknown as string }] })))
      .rejects.toThrow('NOT NULL');

    await expect(store.findSession('conv-1')).resolves.toEqual(buildSessionContext({ agentSessions: [binding('CEO')] }));
  });

  describe('with another process on the same file', () => {
    let dataDir: string;
    let other: DataSource;

    beforeEach(async () => {
      await dataSource.destroy();
      dataDir = mkdtempSync(join(tmpdir(), 'sqlite-sessions-'));
      const options = { type: 'better-sqlite3', database: join(dataDir, 'arc.sqlite'), entities: DATABASE_ENTITIES, migrations: DATABASE_MIGRATIONS } as const;
      dataSource = await new DataSource({ ...options, migrationsRun: true }).initialize();
      other = await new DataSource(options).initialize();
      store = storeOver(dataSource);
    });

    afterEach(async () => {
      await other.destroy();
      await dataSource.destroy();
      rmSync(dataDir, { recursive: true, force: true });
    });

    it('should keep the bindings each process added, interleaved', async () => {
      const otherStore = storeOver(other);

      await Promise.all(['CEO', 'DEVELOPER', 'QA', 'TECH_LEAD'].map((role, index) => (index % 2 === 0 ? store : otherStore).updateSession('conv-1', addBinding(role))));

      expect((await otherStore.findSession('conv-1'))?.agentSessions.map(session => session.role).sort()).toEqual(['CEO', 'DEVELOPER', 'QA', 'TECH_LEAD']);
    });
  });
});
