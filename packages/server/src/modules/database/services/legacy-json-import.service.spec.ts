import { Logger } from '@nestjs/common';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource, EntityManager } from 'typeorm';

import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { createNodeLockedFiles } from '../../storage/testing/node-locked-files.js';
import { StubFileLock } from '../../storage/testing/stub-file-lock.js';
import { PromptHistoryEntity } from '../../web/entities/prompt-history.entity.js';
import { LegacyImportEntity } from '../entities/legacy-import.entity.js';
import type { ILegacyJsonImporterPort, LegacyJsonImport } from '../ports/legacy-json-importer.port.js';
import { createInMemoryDataSource } from '../testing/in-memory-data-source.js';

import { LegacyJsonFilesService } from './legacy-json-files.service.js';
import { LegacyJsonImportService } from './legacy-json-import.service.js';


class FakeImporter implements ILegacyJsonImporterPort {
  reads = 0;
  failRead?: unknown;
  failWrite?: Error;

  constructor(readonly name: string, private readonly files: readonly string[], private readonly prompts: readonly string[] = []) {}

  async read(): Promise<LegacyJsonImport> {
    this.reads += 1;
    if (this.failRead !== undefined) {
      throw this.failRead;
    }
    return {
      files: this.files,
      counts: { prompts: this.prompts.length },
      write: async (manager: EntityManager) => {
        for (const prompt of this.prompts) {
          await manager.insert(PromptHistoryEntity, { prompt });
        }
        if (this.failWrite) {
          throw this.failWrite;
        }
      },
    };
  }
}

describe('LegacyJsonImportService', () => {
  const backup = join('legacy-json-backup', '2026-01-01T00-00-00.000Z');
  let dataDir: string;
  let dataSource: DataSource;
  const createService = (...importers: ILegacyJsonImporterPort[]) => {
    const lock = new StubFileLock();
    return new LegacyJsonImportService(dataSource, new LegacyJsonFilesService(dataDirectoryAt(dataDir), lock, createNodeLockedFiles(lock)), importers);
  };
  const seed = (path: string) => {
    mkdirSync(join(dataDir, path, '..'), { recursive: true });
    writeFileSync(join(dataDir, path), '[]');
  };
  const prompts = async () => (await dataSource.getRepository(PromptHistoryEntity).find({ order: { id: 'ASC' } })).map(row => row.prompt);
  const records = () => dataSource.getRepository(LegacyImportEntity).find({ order: { importer: 'ASC' } });

  beforeEach(async () => {
    rs.useFakeTimers({ toFake: ['Date'] });
    rs.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    dataDir = mkdtempSync(join(tmpdir(), 'legacy-import-'));
    dataSource = await createInMemoryDataSource();
  });

  afterEach(async () => {
    rs.useRealTimers();
    rs.restoreAllMocks();
    await dataSource.destroy();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should write each import, record it and move its files to the backup on module init', async () => {
    const log = rs.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    seed(join('web', 'a.json'));
    seed(join('web', 'b.json'));
    const service = createService(new FakeImporter('first', [join('web', 'a.json')], ['one']), new FakeImporter('second', [join('web', 'b.json')], ['two', 'three']));

    await service.onModuleInit();

    expect(await prompts()).toEqual(['one', 'two', 'three']);
    expect(await records()).toEqual([
      { importer: 'first', importedAt: '2026-01-01T00:00:00.000Z', counts: { prompts: 1 } },
      { importer: 'second', importedAt: '2026-01-01T00:00:00.000Z', counts: { prompts: 2 } },
    ]);
    expect(existsSync(join(dataDir, 'web', 'a.json'))).toBe(false);
    expect(existsSync(join(dataDir, backup, 'web', 'a.json'))).toBe(true);
    expect(existsSync(join(dataDir, backup, 'web', 'b.json'))).toBe(true);
    expect(log).toHaveBeenCalledWith(`[Legacy Import] second: 2 prompts; 1 of 1 files moved to ${backup}`);
  });

  it('should run an importer once', async () => {
    const importer = new FakeImporter('once', [], ['one']);
    await createService(importer).importAll();

    await createService(importer).importAll();

    expect(importer.reads).toBe(1);
    expect(await prompts()).toEqual(['one']);
  });

  it('should record an importer that found no files without logging it', async () => {
    const log = rs.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await createService(new FakeImporter('empty', [])).importAll();

    expect(await records()).toEqual([{ importer: 'empty', importedAt: '2026-01-01T00:00:00.000Z', counts: { prompts: 0 } }]);
    expect(log).not.toHaveBeenCalled();
    expect(existsSync(join(dataDir, 'legacy-json-backup'))).toBe(false);
  });

  it('should log an importer that cannot read, leave it for the next boot and run the others', async () => {
    const warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const failing = new FakeImporter('failing', []);
    failing.failRead = new Error('locked');
    const nonError = new FakeImporter('non-error', []);
    nonError.failRead = 'gone';

    await createService(failing, nonError, new FakeImporter('working', [], ['one'])).importAll();

    expect(warn).toHaveBeenCalledWith('legacy_import_failed: failing: locked');
    expect(warn).toHaveBeenCalledWith('legacy_import_failed: non-error: gone');
    expect((await records()).map(record => record.importer)).toEqual(['working']);
  });

  it('should roll back an import whose write fails and keep its files', async () => {
    rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    seed('legacy.json');
    const importer = new FakeImporter('broken', ['legacy.json'], ['one']);
    importer.failWrite = new Error('constraint');

    await createService(importer).importAll();

    expect(await prompts()).toEqual([]);
    expect(await records()).toEqual([]);
    expect(existsSync(join(dataDir, 'legacy.json'))).toBe(true);
  });
});
