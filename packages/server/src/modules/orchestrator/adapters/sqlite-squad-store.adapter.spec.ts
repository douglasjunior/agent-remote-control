import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

import { DATABASE_ENTITIES, DATABASE_MIGRATIONS } from '../../database/constants/database-schema.constant.js';
import { SqliteTransactionService } from '../../database/services/sqlite-transaction.service.js';
import { createInMemoryDataSource } from '../../database/testing/in-memory-data-source.js';
import type { AgentProfileSettings } from '../models/agent-settings.model.js';
import type { SquadDraft } from '../ports/squad-store.port.js';

import { SqliteSquadStoreAdapter } from './sqlite-squad-store.adapter.js';


const CLAUDE: AgentProfileSettings = { agentId: 'claude', agentName: 'Claude Code', modelId: 'opus', modelName: 'Opus', effortId: 'high', effortName: 'High' };
const CODEX: AgentProfileSettings = { agentId: 'codex', agentName: 'Codex', modelId: null, modelName: null, effortId: null, effortName: null };

const draft = (overrides: Partial<SquadDraft> = {}): SquadDraft => ({
  name: 'Backend team',
  isDefault: false,
  profiles: { CEO: CLAUDE, DEVELOPER: CODEX },
  ...overrides,
});

const storeOver = (dataSource: DataSource) => new SqliteSquadStoreAdapter(dataSource, new SqliteTransactionService(dataSource));

describe('SqliteSquadStoreAdapter', () => {
  let dataSource: DataSource;
  let store: SqliteSquadStoreAdapter;

  const saved = async (overrides: Partial<SquadDraft> = {}) => {
    const outcome = await store.save(draft(overrides));
    if (!outcome.ok) {
      throw new Error(outcome.reason);
    }
    return outcome.squad;
  };

  beforeEach(async () => {
    dataSource = await createInMemoryDataSource();
    store = storeOver(dataSource);
  });

  afterEach(async () => {
    rs.useRealTimers();
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('should have no squad at first', async () => {
    await expect(store.list()).resolves.toEqual([]);
    await expect(store.get('s')).resolves.toBeNull();
    await expect(store.findDefault()).resolves.toBeNull();
  });

  it('should create a squad with a new id and keep it for another store, one row per role', async () => {
    const squad = await saved({ description: 'APIs' });

    expect(squad).toEqual({
      id: expect.any(String),
      name: 'Backend team',
      description: 'APIs',
      isDefault: false,
      profiles: { CEO: CLAUDE, DEVELOPER: CODEX },
      createdAt: expect.any(String),
      updatedAt: squad.createdAt,
    });
    await expect(storeOver(dataSource).get(squad.id)).resolves.toEqual(squad);
    expect(await dataSource.query('SELECT "role", "agent_id" FROM "squad_profile" ORDER BY "role"')).toEqual([
      { role: 'CEO', agent_id: 'claude' },
      { role: 'DEVELOPER', agent_id: 'codex' },
    ]);
  });

  it('should replace a squad, keeping the time it was created', async () => {
    rs.useFakeTimers({ toFake: ['Date'] });
    rs.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const created = await saved({ description: 'APIs' });
    rs.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));

    const outcome = await store.save({ id: created.id, name: 'Platform', isDefault: false, profiles: { QA: CODEX } });

    const replaced = { id: created.id, name: 'Platform', isDefault: false, profiles: { QA: CODEX }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' };
    expect(outcome).toEqual({ ok: true, squad: replaced });
    await expect(store.get(created.id)).resolves.toEqual(replaced);
  });

  it('should list the squads by name in any letter case', async () => {
    await saved({ name: 'frontend' });
    await saved({ name: 'Backend' });
    await saved({ name: 'Data' });

    expect((await store.list()).map(squad => [squad.name, Object.keys(squad.profiles)])).toEqual([
      ['Backend', ['CEO', 'DEVELOPER']],
      ['Data', ['CEO', 'DEVELOPER']],
      ['frontend', ['CEO', 'DEVELOPER']],
    ]);
  });

  it('should refuse a name another squad has in any letter case, and keep its own name', async () => {
    const squad = await saved();

    await expect(store.save(draft({ name: 'BACKEND TEAM' }))).resolves.toEqual({ ok: false, reason: 'name-taken' });
    await expect(store.save(draft({ id: squad.id, name: 'backend team' }))).resolves.toMatchObject({ ok: true });
    expect(await store.list()).toHaveLength(1);
  });

  it('should refuse to replace a squad that does not exist', async () => {
    await expect(store.save(draft({ id: 'missing' }))).resolves.toEqual({ ok: false, reason: 'not-found' });
    await expect(store.list()).resolves.toEqual([]);
  });

  it('should keep one default squad at most', async () => {
    const first = await saved({ name: 'First', isDefault: true });
    await expect(store.findDefault()).resolves.toEqual(first);

    const second = await saved({ name: 'Second', isDefault: true });

    await expect(store.findDefault()).resolves.toEqual(second);
    await expect(store.get(first.id)).resolves.toMatchObject({ isDefault: false });
    await saved({ id: second.id, name: 'Second', isDefault: true });
    expect(await dataSource.query('SELECT COUNT(*) AS "count" FROM "squad" WHERE "is_default" = 1')).toEqual([{ count: 1 }]);
  });

  it('should delete a squad and its profiles', async () => {
    const squad = await saved();

    await expect(store.delete(squad.id)).resolves.toBe(true);
    await expect(store.delete(squad.id)).resolves.toBe(false);

    await expect(store.get(squad.id)).resolves.toBeNull();
    expect(await dataSource.query('SELECT * FROM "squad_profile"')).toEqual([]);
  });

  it('should roll back a save the database refuses', async () => {
    const squad = await saved();
    await dataSource.query('DROP TABLE "squad_profile"');

    await expect(store.save(draft({ id: squad.id, name: 'Renamed' }))).rejects.toThrow('no such table');

    expect(await dataSource.query('SELECT "name" FROM "squad"')).toEqual([{ name: 'Backend team' }]);
  });

  describe('with another process on the same file', () => {
    let dataDir: string;
    let other: DataSource;

    beforeEach(async () => {
      await dataSource.destroy();
      dataDir = mkdtempSync(join(tmpdir(), 'sqlite-squads-'));
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

    it('should refuse a name the other process saved, and keep its default the only one', async () => {
      const otherStore = storeOver(other);
      await otherStore.save(draft({ isDefault: true }));

      await expect(store.save(draft())).resolves.toEqual({ ok: false, reason: 'name-taken' });
      const mine = await saved({ name: 'Mine', isDefault: true });

      await expect(otherStore.findDefault()).resolves.toEqual(mine);
    });
  });
});
