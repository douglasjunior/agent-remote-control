import { Logger } from '@nestjs/common';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';

import { LegacyJsonFilesService } from '../../database/services/legacy-json-files.service.js';
import { SqliteTransactionService } from '../../database/services/sqlite-transaction.service.js';
import { createInMemoryDataSource } from '../../database/testing/in-memory-data-source.js';
import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { createNodeLockedFiles } from '../../storage/testing/node-locked-files.js';
import { StubFileLock } from '../../storage/testing/stub-file-lock.js';
import type { Artifact } from '../models/artifact.model.js';
import { buildArtifact, buildPopulatedArtifact } from '../testing/artifact.fixture.js';

import { JsonArtifactsImporterAdapter } from './json-artifacts-importer.adapter.js';
import { SqliteArtifactStoreAdapter } from './sqlite-artifact-store.adapter.js';


const CONVERSATION = 'channel:thread/1';
const FILE = join('artifacts', `${encodeURIComponent(CONVERSATION)}.json`);

/** An artifact as the earlier versions wrote it: one `projectName` for every artifact and pull requests without a repository. */
function legacyArtifact(artifact: Artifact): unknown {
  const { projectNames, pullRequests, ...rest } = artifact;
  return { ...rest, projectName: projectNames[0], pullRequests: pullRequests.map(({ repository: _repository, ...link }) => link) };
}

describe('JsonArtifactsImporterAdapter', () => {
  let dataDir: string;
  let dataSource: DataSource;
  let lock: StubFileLock;
  const seed = (path: string, content: unknown) => {
    mkdirSync(join(dataDir, 'artifacts'), { recursive: true });
    writeFileSync(join(dataDir, path), typeof content === 'string' ? content : JSON.stringify(content));
  };
  const importAll = async () => {
    const importer = new JsonArtifactsImporterAdapter(new LegacyJsonFilesService(dataDirectoryAt(dataDir), lock, createNodeLockedFiles(lock)));
    const legacy = await importer.read();
    await dataSource.transaction(manager => legacy.write(manager));
    return { importer, legacy };
  };
  const store = () => new SqliteArtifactStoreAdapter(dataSource, new SqliteTransactionService(dataSource));

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'artifacts-importer-'));
    dataSource = await createInMemoryDataSource();
    lock = new StubFileLock();
  });

  afterEach(async () => {
    rs.restoreAllMocks();
    await dataSource.destroy();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should import each board with its counters, under the lock its store wrote it with', async () => {
    const stored = buildPopulatedArtifact({ id: 'T-1' });
    const populated = { ...stored, pullRequests: stored.pullRequests.map(link => ({ ...link, repository: '.' })) };
    seed(FILE, { counters: { T: 4, F: 1 }, artifacts: [legacyArtifact(stored), legacyArtifact(buildArtifact({ id: 'F-1', type: 'feature' }))] });
    seed(join('artifacts', 'web-2.json'), { artifacts: [legacyArtifact(buildArtifact({ id: 'T-1' }))] });

    const { importer, legacy } = await importAll();

    expect(importer.name).toBe('artifacts');
    expect(legacy).toMatchObject({ files: [FILE, join('artifacts', 'web-2.json')], counts: { boards: 2, artifacts: 3 } });
    expect(lock.lockPaths).toEqual([`${join(dataDir, FILE)}.lock`, `${join(dataDir, 'artifacts', 'web-2.json')}.lock`]);
    expect(await store().conversations()).toEqual([CONVERSATION, 'web-2']);
    expect(await store().list(CONVERSATION)).toEqual([populated, buildArtifact({ id: 'F-1', type: 'feature' })]);
    expect(await store().transaction(CONVERSATION, transaction => transaction.allocateId('task'))).toBe('T-5');
    expect(await store().transaction('web-2', transaction => transaction.allocateId('task'))).toBe('T-2');
  });

  it('should keep an id listed twice at its first place with its last content', async () => {
    seed(FILE, { artifacts: [buildArtifact({ id: 'T-1' }), buildArtifact({ id: 'T-2' }), buildArtifact({ id: 'T-1', title: 'Last' })] });

    const { legacy } = await importAll();

    expect(legacy.counts).toEqual({ boards: 1, artifacts: 2 });
    expect((await store().list(CONVERSATION)).map(({ id, title }) => [id, title])).toEqual([['T-1', 'Last'], ['T-2', 'Artifact T-2']]);
  });

  it('should keep a board the database already holds, artifacts or counters only', async () => {
    await store().transaction(CONVERSATION, transaction => transaction.save(buildArtifact({ id: 'T-9' })));
    await store().transaction('web-2', transaction => transaction.allocateId('task'));
    seed(FILE, { artifacts: [buildArtifact({ id: 'T-1' })] });
    seed(join('artifacts', 'web-2.json'), { artifacts: [buildArtifact({ id: 'T-1' })] });

    await importAll();

    expect((await store().list(CONVERSATION)).map(artifact => artifact.id)).toEqual(['T-9']);
    expect(await store().list('web-2')).toEqual([]);
  });

  it('should import more rows than one statement binds', async () => {
    seed(FILE, { artifacts: Array.from({ length: 300 }, (_, index) => buildArtifact({ id: `T-${index + 1}` })) });

    await importAll();

    expect(await dataSource.query('SELECT COUNT(*) AS "count" FROM "artifact_refinement"')).toEqual([{ count: 900 }]);
  });

  it('should import the single project of an old feature as its only project, and the pull requests of the project folder itself', async () => {
    seed(FILE, {
      artifacts: [
        legacyArtifact(buildArtifact({ id: 'F-1', type: 'feature', projectNames: ['shop'] })),
        legacyArtifact(buildArtifact({ id: 'T-1', parentId: 'F-1', projectName: 'shop', pullRequests: [{ url: 'https://example.com/pr/1', repository: '.', state: 'open', addedAt: '2026-01-03T00:00:00.000Z' }] })),
      ],
    });

    await importAll();

    expect(await store().find(CONVERSATION, 'F-1')).toMatchObject({ projectName: null, projectNames: ['shop'] });
    expect(await store().find(CONVERSATION, 'T-1')).toMatchObject({ projectName: 'shop', projectNames: ['shop'], pullRequests: [{ repository: '.' }] });
    expect(await dataSource.query('SELECT "project_name" FROM "artifact" ORDER BY "position"')).toEqual([{ project_name: null }, { project_name: 'shop' }]);
  });

  it('should import a board written before the design refinement with the design skipped', async () => {
    seed(FILE, { artifacts: [{ ...buildArtifact({ id: 'T-1' }), refinement: { business: 'pending', technical: 'done' } }] });

    await importAll();

    expect((await store().find(CONVERSATION, 'T-1'))?.refinement).toEqual({ business: 'pending', design: 'skipped', technical: 'done' });
  });

  it('should leave out a board that does not parse and the other files of the folder', async () => {
    rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    seed(FILE, { artifacts: [{ id: 1 }] });
    seed(join('artifacts', 'broken.json'), '{');
    seed(join('artifacts', 'web-2.json.lock'), '');

    const { legacy } = await importAll();

    expect(legacy).toMatchObject({ files: [], counts: { boards: 0, artifacts: 0 } });
    expect(await store().conversations()).toEqual([]);
  });

  it('should import nothing without the folder', async () => {
    expect((await importAll()).legacy).toMatchObject({ files: [], counts: { boards: 0, artifacts: 0 } });
  });
});
