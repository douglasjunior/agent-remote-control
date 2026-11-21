import { Logger } from '@nestjs/common';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';

import { LegacyJsonFilesService } from '../../database/services/legacy-json-files.service.js';
import { SqliteTransactionService } from '../../database/services/sqlite-transaction.service.js';
import { createInMemoryDataSource } from '../../database/testing/in-memory-data-source.js';
import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { createNodeLockedFiles } from '../../storage/testing/node-locked-files.js';
import { StubFileLock } from '../../storage/testing/stub-file-lock.js';

import { JsonPreferencesImporterAdapter } from './json-preferences-importer.adapter.js';
import { SqlitePreferencesStoreAdapter } from './sqlite-preferences-store.adapter.js';


describe('JsonPreferencesImporterAdapter', () => {
  let dataDir: string;
  let dataSource: DataSource;
  let importer: JsonPreferencesImporterAdapter;
  const seed = (content: string) => writeFileSync(join(dataDir, 'preferences.json'), content);
  const importAll = async () => {
    const legacy = await importer.read();
    await dataSource.transaction(manager => legacy.write(manager));
    return legacy;
  };
  const stored = () => new SqlitePreferencesStoreAdapter(dataSource, new SqliteTransactionService(dataSource)).load();

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'preferences-importer-'));
    dataSource = await createInMemoryDataSource();
    const lock = new StubFileLock();
    importer = new JsonPreferencesImporterAdapter(new LegacyJsonFilesService(dataDirectoryAt(dataDir), lock, createNodeLockedFiles(lock)));
  });

  afterEach(async () => {
    rs.restoreAllMocks();
    await dataSource.destroy();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should import the language and the time it was set', async () => {
    seed('{"language":"Brazilian Portuguese","updatedAt":"2026-01-01T00:00:00.000Z"}');

    const legacy = await importAll();

    expect(importer.name).toBe('preferences');
    expect(legacy).toMatchObject({ files: ['preferences.json'], counts: { languages: 1 } });
    await expect(stored()).resolves.toEqual({ language: 'Brazilian Portuguese', updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(existsSync(join(dataDir, 'preferences.json'))).toBe(true);
  });

  it('should leave out a field of another type, as the JSON store read it', async () => {
    seed('{"language":42,"updatedAt":"2026-01-01T00:00:00.000Z"}');

    expect((await importAll()).counts).toEqual({ languages: 0 });
    await expect(stored()).resolves.toEqual({ updatedAt: '2026-01-01T00:00:00.000Z' });
  });

  it('should keep the preferences the database already holds', async () => {
    await new SqlitePreferencesStoreAdapter(dataSource, new SqliteTransactionService(dataSource)).update(() => ({ language: 'German' }));
    seed('{"language":"Spanish"}');

    await importAll();

    await expect(stored()).resolves.toMatchObject({ language: 'German' });
  });

  it('should import nothing from a missing, empty or corrupt file', async () => {
    rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    expect(await importAll()).toMatchObject({ files: [], counts: { languages: 0 } });
    seed('null');
    expect(await importAll()).toMatchObject({ files: ['preferences.json'], counts: { languages: 0 } });
    seed('{broken');
    expect(await importAll()).toMatchObject({ files: [], counts: { languages: 0 } });
    await expect(stored()).resolves.toEqual({});
  });
});
