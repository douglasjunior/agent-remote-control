import type { ConversationSummary } from '@agent-remote-control/protocol/conversation';
import { Logger } from '@nestjs/common';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';

import { LegacyJsonFilesService } from '../../database/services/legacy-json-files.service.js';
import { createInMemoryDataSource } from '../../database/testing/in-memory-data-source.js';
import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { NodeFileLockAdapter } from '../../storage/adapters/node-file-lock.adapter.js';
import { createNodeLockedFiles } from '../../storage/testing/node-locked-files.js';

import { JsonConversationsImporterAdapter } from './json-conversations-importer.adapter.js';
import { SqliteConversationStoreAdapter } from './sqlite-conversation-store.adapter.js';


const first = 'web-11111111-1111-4111-8111-111111111111';
const second = 'web-22222222-2222-4222-8222-222222222222';
const summary = (id: string, extra: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id, title: `Title ${id}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', ...extra,
});

describe('JsonConversationsImporterAdapter', () => {
  let dataDir: string;
  let dataSource: DataSource;
  let importer: JsonConversationsImporterAdapter;
  const seed = (path: string, content: unknown) => {
    mkdirSync(join(dataDir, path, '..'), { recursive: true });
    writeFileSync(join(dataDir, path), typeof content === 'string' ? content : JSON.stringify(content));
  };
  const importAll = async () => {
    const legacy = await importer.read();
    await dataSource.transaction(manager => legacy.write(manager));
    return legacy;
  };
  const store = () => new SqliteConversationStoreAdapter(dataSource);

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'conversations-importer-'));
    dataSource = await createInMemoryDataSource();
    const lock = new NodeFileLockAdapter();
    importer = new JsonConversationsImporterAdapter(new LegacyJsonFilesService(dataDirectoryAt(dataDir), lock, createNodeLockedFiles(lock)));
  });

  afterEach(async () => {
    rs.restoreAllMocks();
    await dataSource.destroy();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should import every conversation of the index', async () => {
    seed('web/conversations.json', [summary(first, { archivedAt: '2026-01-03T00:00:00.000Z' }), summary(second, { updatedAt: '2026-01-04T00:00:00.000Z' })]);

    const legacy = await importAll();

    expect(importer.name).toBe('web-conversations');
    expect(legacy.counts).toEqual({ conversations: 2 });
    expect(legacy.files).toEqual([join('web', 'conversations.json')]);
    expect(await store().list()).toEqual([
      summary(second, { updatedAt: '2026-01-04T00:00:00.000Z' }),
      summary(first, { archivedAt: '2026-01-03T00:00:00.000Z' }),
    ]);
  });

  it('should keep the latest version of a conversation listed twice', async () => {
    seed('web/conversations.json', [summary(first), summary(first, { title: 'Latest' })]);

    const legacy = await importAll();

    expect(legacy.counts).toEqual({ conversations: 1 });
    expect(await store().list()).toEqual([summary(first, { title: 'Latest' })]);
  });

  it('should import nothing when there are no files', async () => {
    const legacy = await importAll();

    expect(legacy).toMatchObject({ files: [], counts: { conversations: 0 } });
    expect(await store().list()).toEqual([]);
  });

  it('should skip ids that are not file names', async () => {
    seed('web/conversations.json', [summary(first), summary('../escape')]);

    const legacy = await importAll();

    expect(legacy.counts).toEqual({ conversations: 1 });
    expect(await store().exists('../escape')).toBe(false);
  });

  it('should import nothing from a corrupt list of conversations', async () => {
    const warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    seed('web/conversations.json', '{"not":"a list"}');

    const legacy = await importAll();

    expect(legacy).toMatchObject({ files: [], counts: { conversations: 0 } });
    expect(warn).toHaveBeenCalledWith(`legacy_file_skipped: ${join('web', 'conversations.json')} does not match the format it was written in`);
  });

  it('should insert a long list in batches', async () => {
    const summaries = Array.from({ length: 1_234 }, (_, index) => summary(`web-${index}`, { updatedAt: new Date(index * 1000).toISOString() }));
    seed('web/conversations.json', summaries);

    await importAll();

    expect(await store().list()).toHaveLength(1_234);
  });
});
