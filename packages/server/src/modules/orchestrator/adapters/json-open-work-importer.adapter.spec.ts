import { Logger } from '@nestjs/common';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';

import { LegacyJsonFilesService } from '../../database/services/legacy-json-files.service.js';
import { SqliteTransactionService } from '../../database/services/sqlite-transaction.service.js';
import { createInMemoryDataSource } from '../../database/testing/in-memory-data-source.js';
import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { createNodeLockedFiles } from '../../storage/testing/node-locked-files.js';
import { StubFileLock } from '../../storage/testing/stub-file-lock.js';
import type { OpenWork } from '../models/open-work.model.js';

import { JsonOpenWorkImporterAdapter } from './json-open-work-importer.adapter.js';
import { SqliteOpenWorkStoreAdapter } from './sqlite-open-work-store.adapter.js';


const record: OpenWork = { id: 'd', role: 'DEVELOPER', roleName: 'Dev', projectName: null, summary: 'Build', taskSpec: 'Go', cwd: '/w', round: 1, root: false };
const asked: OpenWork = {
  ...record,
  id: 'q',
  artifactId: 'T-1',
  root: true,
  questions: { message: 'One question.', questions: [{ text: 'Which?', options: ['A', 'B'] }], answers: [] },
};

describe('JsonOpenWorkImporterAdapter', () => {
  let dataDir: string;
  let dataSource: DataSource;
  let lock: StubFileLock;
  const seed = (content: unknown) => writeFileSync(join(dataDir, 'open-work.json'), typeof content === 'string' ? content : JSON.stringify(content));
  const importAll = async () => {
    const importer = new JsonOpenWorkImporterAdapter(new LegacyJsonFilesService(dataDirectoryAt(dataDir), lock, createNodeLockedFiles(lock)));
    const legacy = await importer.read();
    await dataSource.transaction(manager => legacy.write(manager));
    return { importer, legacy };
  };
  const seedArtifact = (conversationId: string, id: string, type: 'feature' | 'task') => dataSource.query(
    'INSERT INTO "artifact" ("conversation_id", "id", "position", "type", "title", "status", "created_at", "updated_at") VALUES (?, ?, 0, ?, \'Title\', \'ready\', \'2026-01-01T00:00:00.000Z\', \'2026-01-01T00:00:00.000Z\')',
    [conversationId, id, type],
  );
  const store = () => new SqliteOpenWorkStoreAdapter(new SqliteTransactionService(dataSource));

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'open-work-importer-'));
    dataSource = await createInMemoryDataSource();
    lock = new StubFileLock();
  });

  afterEach(async () => {
    rs.restoreAllMocks();
    await dataSource.destroy();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should import the records of each conversation in order, under the lock its store wrote it with', async () => {
    seed({ 'web-1': [asked, record], 'web-2': [record], 'web-3': [] });

    const { importer, legacy } = await importAll();

    expect(importer.name).toBe('open-work');
    expect(legacy).toMatchObject({ files: ['open-work.json'], counts: { records: 3 } });
    expect(lock.lockPaths).toEqual([`${join(dataDir, 'open-work.json')}.lock`]);
    await expect(store().load()).resolves.toEqual({ 'web-1': [asked, record], 'web-2': [record] });
  });

  it('should key the work of a feature to the workspaces root and leave the rest as it is', async () => {
    await seedArtifact('web-1', 'F-1', 'feature');
    await seedArtifact('web-1', 'T-1', 'task');
    const feature: OpenWork = { ...record, id: 'f', artifactId: 'F-1', projectName: 'api', cwd: '/w/api' };
    const foreign: OpenWork = { ...feature, id: 'g', cwd: '/elsewhere' };
    const rootFeature: OpenWork = { ...feature, id: 'h', projectName: null, cwd: '/w' };
    const task: OpenWork = { ...record, id: 't', artifactId: 'T-1', projectName: 'api', cwd: '/w/api' };
    seed({ 'web-1': [feature, foreign, rootFeature, task, record] });

    await importAll();

    await expect(store().load()).resolves.toEqual({
      'web-1': [
        { ...feature, projectName: null, cwd: '/w' },
        { ...foreign, projectName: null },
        rootFeature,
        task,
        record,
      ],
    });
  });

  it('should drop a record that is not valid open work', async () => {
    const warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    seed({ 'web-1': [{ ...record, round: 'one' }, record, null] });

    const { legacy } = await importAll();

    expect(legacy.counts).toEqual({ records: 1 });
    await expect(store().load()).resolves.toEqual({ 'web-1': [record] });
    expect(warn).toHaveBeenCalledWith('legacy_record_skipped: a record of web-1 in open-work.json is not valid open work');
  });

  it('should keep a conversation the database already holds', async () => {
    await store().update(() => ({ 'web-1': [asked] }));
    seed({ 'web-1': [record], 'web-2': [record] });

    await importAll();

    await expect(store().load()).resolves.toEqual({ 'web-1': [asked], 'web-2': [record] });
  });

  it('should import more rows than one statement binds', async () => {
    seed({ 'web-1': Array.from({ length: 600 }, (_, index) => ({ ...record, id: `d-${index}` })) });

    await importAll();

    expect(await dataSource.query('SELECT COUNT(*) AS "count" FROM "open_work"')).toEqual([{ count: 600 }]);
  });

  it('should import nothing from a missing or invalid file, leaving an invalid one in place', async () => {
    rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    expect((await importAll()).legacy).toMatchObject({ files: [], counts: { records: 0 } });
    for (const content of ['{', '[]', 'null', '{"web-1": {}}']) {
      seed(content);
      expect((await importAll()).legacy).toMatchObject({ files: [], counts: { records: 0 } });
    }
    await expect(store().load()).resolves.toEqual({});
  });
});
