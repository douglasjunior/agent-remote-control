import type { ConversationSummary } from '@agent-remote-control/protocol/conversation';
import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
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
const message = (id: string, text = id): ConversationEntry => ({ id, at: '2026-01-01T00:00:00.000Z', type: 'user_message', text });

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

  it('should import every conversation with its history in order', async () => {
    seed('web/conversations.json', [summary(first, { archivedAt: '2026-01-03T00:00:00.000Z' }), summary(second, { updatedAt: '2026-01-04T00:00:00.000Z' })]);
    seed(`web/history/${first}.json`, [message('a'), message('b')]);
    seed(`web/history/${second}.json`, [message('c')]);

    const legacy = await importAll();

    expect(importer.name).toBe('web-conversations');
    expect(legacy.counts).toEqual({ conversations: 2, entries: 3 });
    expect(legacy.files).toEqual([join('web', 'conversations.json'), join('web', 'history', `${first}.json`), join('web', 'history', `${second}.json`)]);
    expect(await store().list()).toEqual([summary(second, { updatedAt: '2026-01-04T00:00:00.000Z' }), summary(first, { archivedAt: '2026-01-03T00:00:00.000Z' })]);
    expect(await store().history(first)).toEqual([message('a'), message('b')]);
    expect(await store().upsertEntry(first, message('d'))).toBe(2);
  });

  it('should keep one entry per id at its first place with its latest version', async () => {
    seed('web/conversations.json', [summary(first)]);
    seed(`web/history/${first}.json`, [message('a'), message('b'), message('a', 'edited')]);

    const legacy = await importAll();

    expect(legacy.counts).toEqual({ conversations: 1, entries: 2 });
    expect(await store().history(first)).toEqual([message('a', 'edited'), message('b')]);
  });

  it('should import nothing when there are no files', async () => {
    const legacy = await importAll();

    expect(legacy).toMatchObject({ files: [], counts: { conversations: 0, entries: 0 } });
    expect(await store().list()).toEqual([]);
  });

  it('should import a conversation without a history file with no entries', async () => {
    seed('web/conversations.json', [summary(first)]);

    const legacy = await importAll();

    expect(legacy.files).toEqual([join('web', 'conversations.json')]);
    expect(await store().history(first)).toEqual([]);
  });

  it('should skip corrupt files, ids that are not file names and histories of no conversation', async () => {
    const warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    seed('web/conversations.json', [summary(first), summary(second), summary('../escape')]);
    seed(`web/history/${first}.json`, '{ broken');
    seed(`web/history/${second}.json`, [message('c')]);
    seed('web/history/web-orphan.json', [message('x')]);

    const legacy = await importAll();

    expect(legacy.counts).toEqual({ conversations: 2, entries: 1 });
    expect(legacy.files).toEqual([join('web', 'conversations.json'), join('web', 'history', `${second}.json`)]);
    expect(await store().history(first)).toEqual([]);
    expect(await store().exists('../escape')).toBe(false);
    expect(warn).toHaveBeenCalledWith(`legacy_file_skipped: ${join('web', 'history', `${first}.json`)} does not match the format it was written in`);
    expect(warn).toHaveBeenCalledWith(`legacy_file_skipped: ${join('web', 'history', 'web-orphan.json')} belongs to no conversation of ${join('web', 'conversations.json')}`);
  });

  it('should import nothing from a corrupt list of conversations', async () => {
    rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    seed('web/conversations.json', '{"not":"a list"}');

    const legacy = await importAll();

    expect(legacy).toMatchObject({ files: [], counts: { conversations: 0, entries: 0 } });
  });

  it('should insert a long history in batches', async () => {
    const entries = Array.from({ length: 1_234 }, (_, index) => message(`e${index}`));
    seed('web/conversations.json', [summary(first)]);
    seed(`web/history/${first}.json`, entries);

    await importAll();

    expect(await store().history(first)).toEqual(entries);
  });
});
