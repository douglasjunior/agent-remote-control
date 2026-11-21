import { Logger } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

import { DATABASE_ENTITIES, DATABASE_MIGRATIONS } from '../../database/constants/database-schema.constant.js';
import { SqliteTransactionService } from '../../database/services/sqlite-transaction.service.js';
import { createInMemoryDataSource } from '../../database/testing/in-memory-data-source.js';
import type { Artifact } from '../models/artifact.model.js';
import { buildArtifact, buildPopulatedArtifact } from '../testing/artifact.fixture.js';

import { SqliteArtifactStoreAdapter } from './sqlite-artifact-store.adapter.js';


const CONVERSATION = 'channel:thread/1';

const storeOver = (dataSource: DataSource) => new SqliteArtifactStoreAdapter(dataSource, new SqliteTransactionService(dataSource));

const saveNew = (store: SqliteArtifactStoreAdapter, conversationId = CONVERSATION, overrides: Partial<Artifact> = {}) =>
  store.transaction(conversationId, (transaction) => {
    const artifact = buildArtifact({ ...overrides, id: transaction.allocateId('task') });
    transaction.save(artifact);
    return artifact.id;
  });

describe('SqliteArtifactStoreAdapter', () => {
  let dataSource: DataSource;
  let store: SqliteArtifactStoreAdapter;
  const count = async (table: string): Promise<number> =>
    ((await dataSource.query(`SELECT COUNT(*) AS "count" FROM "${table}"`)) as { count: number }[])[0]!.count;
  const totalChanges = async (): Promise<number> =>
    ((await dataSource.query('SELECT total_changes() AS "changes"')) as { changes: number }[])[0]!.changes;

  beforeEach(async () => {
    dataSource = await createInMemoryDataSource();
    store = storeOver(dataSource);
  });

  afterEach(async () => {
    rs.restoreAllMocks();
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('should keep one board per conversation, allocating ids per type and reading back what it saved', async () => {
    const ids = await store.transaction(CONVERSATION, (transaction) => {
      const task = buildArtifact({ id: transaction.allocateId('task') });
      const feature = buildArtifact({ id: transaction.allocateId('feature'), type: 'feature' });
      transaction.save(task);
      transaction.save(feature);
      transaction.save(buildArtifact({ id: transaction.allocateId('task') }));
      transaction.remove('T-2');
      return [task.id, feature.id, transaction.find('T-1')?.id, transaction.list().length];
    });
    await saveNew(store, 'web-2');

    expect(ids).toEqual(['T-1', 'F-1', 'T-1', 2]);
    const reloaded = storeOver(dataSource);
    expect(await reloaded.conversations()).toEqual([CONVERSATION, 'web-2']);
    expect((await reloaded.list(CONVERSATION)).map(artifact => artifact.id)).toEqual(['T-1', 'F-1']);
    expect(await reloaded.find(CONVERSATION, 'F-1')).toEqual(buildArtifact({ id: 'F-1', type: 'feature' }));
    expect(await reloaded.find('web-2', 'F-1')).toBeUndefined();
    expect(await reloaded.list('web-3')).toEqual([]);
    expect(await dataSource.query('SELECT "conversation_id", "prefix", "value" FROM "artifact_counter" ORDER BY "conversation_id", "prefix"')).toEqual([
      { conversation_id: CONVERSATION, prefix: 'F', value: 1 },
      { conversation_id: CONVERSATION, prefix: 'T', value: 2 },
      { conversation_id: 'web-2', prefix: 'T', value: 1 },
    ]);
    expect(await reloaded.transaction(CONVERSATION, transaction => transaction.allocateId('task'))).toBe('T-3');
  });

  it('should read back an artifact with every field filled, one row per item of its lists', async () => {
    const artifact = buildPopulatedArtifact({ id: 'T-1' });

    await store.transaction(CONVERSATION, transaction => transaction.save(artifact));

    expect(await storeOver(dataSource).find(CONVERSATION, 'T-1')).toEqual(artifact);
    expect(await storeOver(dataSource).list(CONVERSATION)).toEqual([artifact]);
    expect(await dataSource.query('SELECT "kind", "state" FROM "artifact_refinement" ORDER BY "kind"')).toEqual([
      { kind: 'business', state: 'skipped' },
      { kind: 'design', state: 'done' },
      { kind: 'technical', state: 'pending' },
    ]);
    expect(await dataSource.query('SELECT "position", "depends_on_id" FROM "artifact_dependency" ORDER BY "position"')).toEqual([
      { position: 0, depends_on_id: 'T-7' },
      { position: 1, depends_on_id: 'T-3' },
    ]);
    expect(await dataSource.query('SELECT "event_position", "field", "from_value", "to_value" FROM "artifact_history_change" ORDER BY "position"')).toEqual([
      { event_position: 1, field: 'status', from_value: 'ready', to_value: 'tested' },
      { event_position: 1, field: 'section:overview', from_value: null, to_value: 'replaced' },
      { event_position: 1, field: 'branch', from_value: null, to_value: null },
    ]);
    expect(await count('artifact_section')).toBe(2);
    expect(await count('artifact_pull_request')).toBe(2);
    expect(await count('artifact_history')).toBe(3);
  });

  it('should rewrite only what changed, keeping each artifact at its place on the board', async () => {
    const populated = buildPopulatedArtifact({ id: 'T-1' });
    await store.transaction(CONVERSATION, (transaction) => {
      transaction.save(populated);
      transaction.save(buildArtifact({ id: 'T-2' }));
    });
    const [firstEvent, , lastEvent] = populated.history;
    const changed: Artifact = {
      ...populated,
      title: 'Renamed',
      assignee: null,
      dependsOn: ['T-2'],
      pullRequests: [],
      sections: { overview: 'New' },
      history: [firstEvent!, { ...lastEvent!, summary: 'Released again' }],
    };
    const rowIds = () => dataSource.query(
      'SELECT "rowid" FROM "artifact_history" WHERE "position" = 0 UNION ALL SELECT "rowid" FROM "artifact_refinement" WHERE "artifact_id" = \'T-2\' '
      + 'UNION ALL SELECT "rowid" FROM "artifact" WHERE "id" = \'T-2\'',
    );
    const before = await rowIds();

    await store.transaction(CONVERSATION, (transaction) => {
      transaction.save(changed);
      transaction.save(buildArtifact({ id: 'T-3' }));
    });

    expect(await storeOver(dataSource).list(CONVERSATION)).toEqual([changed, buildArtifact({ id: 'T-2' }), buildArtifact({ id: 'T-3' })]);
    expect(await count('artifact_history_change')).toBe(0);
    expect(await rowIds()).toEqual(before);
  });

  it('should write an appended history event as its one row', async () => {
    const artifact = buildPopulatedArtifact({ id: 'T-1' });
    await store.transaction(CONVERSATION, transaction => transaction.save(artifact));
    const before = await totalChanges();
    const commented: Artifact = {
      ...artifact,
      history: [...artifact.history, { id: 'e-4', at: '2026-01-06T00:00:00.000Z', actor: { kind: 'user', channel: 'discord' }, kind: 'commented', summary: 'Commented', text: 'Hi' }],
    };

    await store.transaction(CONVERSATION, transaction => transaction.save(commented));

    expect(await store.find(CONVERSATION, 'T-1')).toEqual(commented);
    expect(await totalChanges() - before).toBe(1);
  });

  it('should drop every row of a removed artifact and never give its id again', async () => {
    await store.transaction(CONVERSATION, transaction => transaction.save(buildPopulatedArtifact({ id: transaction.allocateId('task') })));

    await store.transaction(CONVERSATION, transaction => transaction.remove('T-1'));

    for (const table of ['artifact', 'artifact_refinement', 'artifact_section', 'artifact_dependency', 'artifact_pull_request', 'artifact_history', 'artifact_history_change']) {
      expect(await count(table)).toBe(0);
    }
    expect(await store.conversations()).toEqual([]);
    expect(await saveNew(store)).toBe('T-2');
  });

  it('should never give an id an artifact already has, even without a counter', async () => {
    await store.transaction(CONVERSATION, transaction => transaction.save(buildArtifact({ id: 'T-1' })));

    expect(await saveNew(store)).toBe('T-2');
  });

  it('should write nothing for a transaction that changes nothing', async () => {
    await saveNew(store);
    const before = await totalChanges();

    await store.transaction(CONVERSATION, transaction => transaction.save(transaction.find('T-1')!));

    expect(await totalChanges()).toBe(before);
  });

  it('should write nothing when the work throws, and reject with its error', async () => {
    await saveNew(store);

    await expect(store.transaction(CONVERSATION, (transaction) => {
      transaction.save(buildArtifact({ id: transaction.allocateId('task') }));
      transaction.remove('T-1');
      throw new Error('refused');
    })).rejects.toThrow('refused');

    expect((await store.list(CONVERSATION)).map(artifact => artifact.id)).toEqual(['T-1']);
    expect(await saveNew(store)).toBe('T-2');
  });

  it('should keep every artifact that interleaved transactions save', async () => {
    await Promise.all(Array.from({ length: 4 }, () => saveNew(store)));

    expect((await store.list(CONVERSATION)).map(artifact => artifact.id)).toEqual(['T-1', 'T-2', 'T-3', 'T-4']);
  });

  it('should read a missing refinement as owed, a missing design as skipped, and leave out an artifact whose rows are invalid', async () => {
    const warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await store.transaction(CONVERSATION, (transaction) => {
      transaction.save(buildArtifact({ id: 'T-1' }));
      transaction.save(buildArtifact({ id: 'T-2' }));
      transaction.save(buildArtifact({ id: 'T-3' }));
    });
    await dataSource.query('DELETE FROM "artifact_refinement" WHERE "artifact_id" = \'T-1\' AND "kind" = \'technical\'');
    await dataSource.query('DELETE FROM "artifact_refinement" WHERE "artifact_id" = \'T-3\'');
    await dataSource.query('INSERT INTO "artifact_refinement" VALUES (?, \'T-1\', \'legal\', \'done\')', [CONVERSATION]);
    await dataSource.query('UPDATE "artifact" SET "status" = \'lost\' WHERE "id" = \'T-2\'');

    expect(await store.list(CONVERSATION)).toEqual([
      buildArtifact({ id: 'T-1', refinement: { business: 'done', design: 'done', technical: 'pending' } }),
      buildArtifact({ id: 'T-3', refinement: { business: 'pending', design: 'skipped', technical: 'pending' } }),
    ]);
    expect(warn).toHaveBeenCalledWith(`artifacts_invalid_row: T-2 of ${CONVERSATION}`);
  });

  describe('with another process on the same file', () => {
    let dataDir: string;
    let other: DataSource;

    beforeEach(async () => {
      await dataSource.destroy();
      dataDir = mkdtempSync(join(tmpdir(), 'sqlite-artifacts-'));
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

    it('should keep every artifact each process saved, interleaved, with ids given once', async () => {
      const otherStore = storeOver(other);

      await Promise.all([saveNew(store), saveNew(otherStore), saveNew(store), saveNew(otherStore)]);

      expect((await otherStore.list(CONVERSATION)).map(artifact => artifact.id).sort()).toEqual(['T-1', 'T-2', 'T-3', 'T-4']);
    });
  });
});
