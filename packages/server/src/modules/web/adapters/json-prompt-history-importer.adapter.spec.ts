import { MAX_PROMPT_HISTORY } from '@agent-remote-control/protocol/limits';
import { Logger } from '@nestjs/common';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';

import { LegacyJsonFilesService } from '../../database/services/legacy-json-files.service.js';
import { createInMemoryDataSource } from '../../database/testing/in-memory-data-source.js';
import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { createNodeLockedFiles } from '../../storage/testing/node-locked-files.js';
import { StubFileLock } from '../../storage/testing/stub-file-lock.js';

import { JsonPromptHistoryImporterAdapter } from './json-prompt-history-importer.adapter.js';
import { SqlitePromptHistoryAdapter } from './sqlite-prompt-history.adapter.js';


describe('JsonPromptHistoryImporterAdapter', () => {
  let dataDir: string;
  let dataSource: DataSource;
  let importer: JsonPromptHistoryImporterAdapter;
  const seed = (content: string) => {
    mkdirSync(join(dataDir, 'web'), { recursive: true });
    writeFileSync(join(dataDir, 'web', 'prompt-history.json'), content);
  };
  const importAll = async () => {
    const legacy = await importer.read();
    await dataSource.transaction(manager => legacy.write(manager));
    return legacy;
  };

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'prompt-history-importer-'));
    dataSource = await createInMemoryDataSource();
    const lock = new StubFileLock();
    importer = new JsonPromptHistoryImporterAdapter(new LegacyJsonFilesService(dataDirectoryAt(dataDir), lock, createNodeLockedFiles(lock)));
  });

  afterEach(async () => {
    rs.restoreAllMocks();
    await dataSource.destroy();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should import the prompts keeping the most recent first', async () => {
    seed('["newest","older","oldest"]');

    const legacy = await importAll();

    expect(importer.name).toBe('web-prompt-history');
    expect(legacy).toMatchObject({ files: [join('web', 'prompt-history.json')], counts: { prompts: 3 } });
    expect(await new SqlitePromptHistoryAdapter(dataSource).list()).toEqual(['newest', 'older', 'oldest']);
  });

  it('should import only the most recent prompts of an oversized file', async () => {
    seed(JSON.stringify(Array.from({ length: MAX_PROMPT_HISTORY + 3 }, (_, index) => `prompt ${index}`)));

    const legacy = await importAll();

    expect(legacy.counts).toEqual({ prompts: MAX_PROMPT_HISTORY });
    expect((await new SqlitePromptHistoryAdapter(dataSource).list())[0]).toBe('prompt 0');
  });

  it('should import nothing from a missing or corrupt file', async () => {
    rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    expect(await importAll()).toMatchObject({ files: [], counts: { prompts: 0 } });
    seed('{"not":"a list"}');
    expect(await importAll()).toMatchObject({ files: [], counts: { prompts: 0 } });
    expect(await new SqlitePromptHistoryAdapter(dataSource).list()).toEqual([]);
  });
});
