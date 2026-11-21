import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

import { DATABASE_ENTITIES, DATABASE_MIGRATIONS } from '../../database/constants/database-schema.constant.js';
import { SqliteTransactionService } from '../../database/services/sqlite-transaction.service.js';
import { createInMemoryDataSource } from '../../database/testing/in-memory-data-source.js';
import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';

import { SqliteAgentSettingsStoreAdapter } from './sqlite-agent-settings-store.adapter.js';


const CLAUDE: AgentProfileSettings = {
  agentId: 'claude',
  agentName: 'Claude Code',
  modelId: 'm1',
  modelName: 'Model 1',
  effortId: 'high',
  effortName: 'High',
};

const SETTINGS: AgentSettings = {
  profiles: { CEO: CLAUDE, DEVELOPER: { ...CLAUDE, agentId: 'agy', agentName: 'Antigravity', modelId: null, modelName: null, effortId: null, effortName: null } },
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const storeOver = (dataSource: DataSource) => new SqliteAgentSettingsStoreAdapter(new SqliteTransactionService(dataSource));

const withRole = (role: string, updatedAt: string) => (own: AgentSettings | null): AgentSettings => ({
  profiles: { ...own?.profiles, [role]: { ...CLAUDE, agentId: `agent-${role}` } },
  updatedAt,
});

describe('SqliteAgentSettingsStoreAdapter', () => {
  let dataSource: DataSource;
  let store: SqliteAgentSettingsStoreAdapter;

  beforeEach(async () => {
    dataSource = await createInMemoryDataSource();
    store = storeOver(dataSource);
  });

  afterEach(async () => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('should return null when nothing was saved', async () => {
    await expect(store.load('conv')).resolves.toBeNull();
    await expect(store.loadMostRecent()).resolves.toBeNull();
  });

  it('should keep the settings for another store, one row per role', async () => {
    await expect(store.update('conv', () => SETTINGS)).resolves.toEqual(SETTINGS);

    await expect(storeOver(dataSource).load('conv')).resolves.toEqual(SETTINGS);
    expect(await dataSource.query('SELECT "conversation_id", "role", "agent_id", "model_id" FROM "agent_profile" ORDER BY "role"')).toEqual([
      { conversation_id: 'conv', role: 'CEO', agent_id: 'claude', model_id: 'm1' },
      { conversation_id: 'conv', role: 'DEVELOPER', agent_id: 'agy', model_id: null },
    ]);
  });

  it('should keep the squad the profiles were copied from, and forget it when a change leaves it out', async () => {
    const applied: AgentSettings = { ...SETTINGS, appliedSquad: { id: 's1', name: 'Backend team' } };

    await store.update('conv', () => applied);
    await expect(storeOver(dataSource).load('conv')).resolves.toEqual(applied);
    await expect(store.update('conv', (own) => {
      expect(own).toEqual(applied);
      return SETTINGS;
    })).resolves.toEqual(SETTINGS);

    await expect(store.load('conv')).resolves.toEqual(SETTINGS);
  });

  it('should keep settings isolated per conversation', async () => {
    const copilot: AgentSettings = { profiles: { CEO: { ...CLAUDE, agentId: 'copilot' } }, updatedAt: SETTINGS.updatedAt };

    await store.update('ch:thread-1', () => SETTINGS);
    await store.update('ch:thread-2', () => copilot);

    await expect(store.load('ch:thread-1')).resolves.toEqual(SETTINGS);
    await expect(store.load('ch:thread-2')).resolves.toEqual(copilot);
    await expect(store.load('ch')).resolves.toBeNull();
  });

  it('should replace the roles of a conversation with those of the change', async () => {
    await store.update('conv', () => SETTINGS);

    await store.update('conv', () => ({ profiles: { QA: CLAUDE }, updatedAt: 'later' }));

    await expect(store.load('conv')).resolves.toEqual({ profiles: { QA: CLAUDE }, updatedAt: 'later' });
  });

  it('should resolve an update that stores nothing for a conversation without settings to null', async () => {
    await expect(store.update('conv', () => null)).resolves.toBeNull();
    expect(await dataSource.query('SELECT * FROM "agent_settings"')).toEqual([]);
  });

  it('should hand an update the own and the most recent settings, and write nothing when it returns null', async () => {
    const newer = { ...SETTINGS, profiles: { CEO: CLAUDE }, updatedAt: '2026-02-01T00:00:00.000Z' };
    await store.update('conv-1', () => SETTINGS);
    await store.update('conv-2', () => newer);
    const seen: unknown[] = [];

    await expect(store.update('conv-1', (own, mostRecent) => {
      seen.push(own, mostRecent);
      return null;
    })).resolves.toEqual(SETTINGS);

    expect(seen).toEqual([SETTINGS, newer]);
    await expect(store.loadMostRecent()).resolves.toEqual(newer);
  });

  it('should hand each change what the previous one stored, when they run together', async () => {
    const roles = ['CEO', 'DEVELOPER', 'QA', 'TECH_LEAD'];
    const seen: string[][] = [];

    await Promise.all(roles.map(role => store.update('conv', (own) => {
      seen.push(Object.keys(own?.profiles ?? {}));
      return withRole(role, '2026-01-01T00:00:00.000Z')(own);
    })));

    expect(seen.map(keys => keys.length)).toEqual([0, 1, 2, 3]);
    expect(Object.keys((await storeOver(dataSource).load('conv'))!.profiles).sort()).toEqual([...roles].sort());
  });

  it('should roll back a change the database refuses and keep what was stored', async () => {
    await store.update('conv', () => SETTINGS);
    await dataSource.query('DROP TABLE "agent_profile"');

    await expect(store.update('conv', () => ({ ...SETTINGS, updatedAt: 'later' }))).rejects.toThrow('no such table');

    expect(await dataSource.query('SELECT "updated_at" FROM "agent_settings"')).toEqual([{ updated_at: SETTINGS.updatedAt }]);
  });

  describe('with another process on the same file', () => {
    let dataDir: string;
    let other: DataSource;

    beforeEach(async () => {
      await dataSource.destroy();
      dataDir = mkdtempSync(join(tmpdir(), 'sqlite-agent-settings-'));
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

    it('should keep the roles each process changed, interleaved', async () => {
      const otherStore = storeOver(other);

      await Promise.all([
        ...['CEO', 'QA'].map(role => store.update('conv', withRole(role, 'a'))),
        ...['DEVELOPER', 'GIT_OPS'].map(role => otherStore.update('conv', withRole(role, 'b'))),
      ]);

      expect(Object.keys((await otherStore.load('conv'))!.profiles).sort()).toEqual(['CEO', 'DEVELOPER', 'GIT_OPS', 'QA']);
    });
  });
});
