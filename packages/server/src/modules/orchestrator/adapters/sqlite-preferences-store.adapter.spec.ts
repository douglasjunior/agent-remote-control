import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

import { DATABASE_ENTITIES, DATABASE_MIGRATIONS } from '../../database/constants/database-schema.constant.js';
import { SqliteTransactionService } from '../../database/services/sqlite-transaction.service.js';
import { createInMemoryDataSource } from '../../database/testing/in-memory-data-source.js';

import { SqlitePreferencesStoreAdapter } from './sqlite-preferences-store.adapter.js';


const storeOver = (dataSource: DataSource) => new SqlitePreferencesStoreAdapter(dataSource, new SqliteTransactionService(dataSource));

describe('SqlitePreferencesStoreAdapter', () => {
  let dataSource: DataSource;
  let store: SqlitePreferencesStoreAdapter;

  beforeEach(async () => {
    dataSource = await createInMemoryDataSource();
    store = storeOver(dataSource);
  });

  afterEach(async () => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('should return empty preferences when nothing was saved', async () => {
    await expect(store.load()).resolves.toEqual({});
  });

  it('should keep the language for another store, stamped with the time of the change', async () => {
    const updated = await store.update(() => ({ language: 'Spanish' }));

    expect(updated).toEqual({ language: 'Spanish', updatedAt: expect.any(String) });
    await expect(storeOver(dataSource).load()).resolves.toEqual(updated);
    expect(await dataSource.query('SELECT "id", "language" FROM "preferences"')).toEqual([{ id: 1, language: 'Spanish' }]);
  });

  it('should keep the language when a change leaves it out, and clear it when the change clears it', async () => {
    await store.update(() => ({ language: 'Spanish' }));

    await expect(store.update(() => ({}))).resolves.toMatchObject({ language: 'Spanish' });
    await expect(store.update(() => ({ language: undefined }))).resolves.toEqual({ updatedAt: expect.any(String) });
  });

  it('should write nothing when the change returns undefined', async () => {
    await store.update(() => ({ language: 'Spanish' }));
    const before = await store.load();

    await expect(store.update(() => undefined)).resolves.toEqual(before);
    await expect(store.load()).resolves.toEqual(before);
  });

  it('should hand each change what the previous one stored, when they run together', async () => {
    const seen: (string | undefined)[] = [];

    await Promise.all(['Spanish', 'German'].map(language => store.update((current) => {
      seen.push(current.language);
      return { language: `${current.language ?? ''}${language}` };
    })));

    expect(seen).toEqual([undefined, 'Spanish']);
    await expect(store.load()).resolves.toMatchObject({ language: 'SpanishGerman' });
  });

  it('should reject an update the database refuses', async () => {
    await dataSource.query('DROP TABLE "preferences"');

    await expect(store.update(() => ({ language: 'Spanish' }))).rejects.toThrow('no such table');
  });

  describe('with another process on the same file', () => {
    let dataDir: string;
    let other: DataSource;

    beforeEach(async () => {
      await dataSource.destroy();
      dataDir = mkdtempSync(join(tmpdir(), 'sqlite-preferences-'));
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

    it('should keep a language the other process stored before a detection that only stores one when none is set', async () => {
      const detected = await store.load();
      await storeOver(other).update(() => ({ language: 'Spanish' }));

      expect(detected.language).toBeUndefined();
      await store.update(current => (current.language ? undefined : { language: 'English' }));

      await expect(storeOver(other).load()).resolves.toMatchObject({ language: 'Spanish' });
    });
  });
});
