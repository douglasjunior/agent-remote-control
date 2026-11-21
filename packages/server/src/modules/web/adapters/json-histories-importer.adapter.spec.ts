import type { ConversationSummary } from '@agent-remote-control/protocol/conversation';
import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Logger } from '@nestjs/common';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';

import { AgentRegistryService } from '../../agent-definitions/services/agent-registry.service.js';
import { LegacyImportEntity } from '../../database/entities/legacy-import.entity.js';
import { LegacyJsonFilesService } from '../../database/services/legacy-json-files.service.js';
import { LegacyJsonImportService } from '../../database/services/legacy-json-import.service.js';
import { createInMemoryDataSource } from '../../database/testing/in-memory-data-source.js';
import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { NodeFileLockAdapter } from '../../storage/adapters/node-file-lock.adapter.js';
import { createNodeLockedFiles } from '../../storage/testing/node-locked-files.js';
import { HISTORY_PAGE_SIZE } from '../constants/history-page.constant.js';
import { LegacyConversationEntryUpgraderService } from '../services/legacy-conversation-entry-upgrader.service.js';
import { earlierPageStart, latestPageStart } from '../utils/history-page.util.js';

import { JsonConversationsImporterAdapter } from './json-conversations-importer.adapter.js';
import { JsonHistoriesImporterAdapter } from './json-histories-importer.adapter.js';
import { SqliteConversationStoreAdapter } from './sqlite-conversation-store.adapter.js';


const first = 'web-11111111-1111-4111-8111-111111111111';
const second = 'web-22222222-2222-4222-8222-222222222222';
const createdAt = '2026-01-01T00:00:00.000Z';
const at = '2026-01-01T10:00:00.000Z';
const summary = (id: string): ConversationSummary => ({ id, title: `Title ${id}`, createdAt, updatedAt: '2026-01-02T00:00:00.000Z' });
const message = (id: string, text = id): ConversationEntry => ({ id, at, type: 'user_message', text });
const historyFile = (id: string) => join('web', 'history', `${id}.json`);

describe('JsonHistoriesImporterAdapter', () => {
  let dataDir: string;
  let dataSource: DataSource;
  let conversations: JsonConversationsImporterAdapter;
  let histories: JsonHistoriesImporterAdapter;
  const seed = (path: string, content: unknown) => {
    mkdirSync(join(dataDir, path, '..'), { recursive: true });
    writeFileSync(join(dataDir, path), typeof content === 'string' ? content : JSON.stringify(content));
  };
  const store = () => new SqliteConversationStoreAdapter(dataSource);
  const importAll = () => {
    const lock = new NodeFileLockAdapter();
    return new LegacyJsonImportService(dataSource, new LegacyJsonFilesService(dataDirectoryAt(dataDir), lock, createNodeLockedFiles(lock)), [conversations, histories]).importAll();
  };
  const recorded = async () => (await dataSource.getRepository(LegacyImportEntity).find({ order: { importer: 'ASC' } })).map(row => row.importer);
  const exists = (path: string) => existsSync(join(dataDir, path));
  const spyWarn = () => rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const spyLog = () => rs.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'histories-importer-'));
    dataSource = await createInMemoryDataSource();
    const lock = new NodeFileLockAdapter();
    const files = new LegacyJsonFilesService(dataDirectoryAt(dataDir), lock, createNodeLockedFiles(lock));
    conversations = new JsonConversationsImporterAdapter(files);
    histories = new JsonHistoriesImporterAdapter(files, dataSource, new LegacyConversationEntryUpgraderService(new AgentRegistryService()));
  });

  afterEach(async () => {
    rs.restoreAllMocks();
    await dataSource.destroy();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should import the history of every conversation of a fresh install, converting the legacy entries in place', async () => {
    const log = spyLog();
    seed('web/conversations.json', [summary(first), summary(second)]);
    seed(historyFile(first), [
      message('a'),
      { id: 'steer', at, type: 'agent_response', status: 'steered', response: '', agentInfo: { roleName: 'CEO', agentName: 'Claude' } },
      { id: 'thought:1', at, type: 'thought', text: 'hmm' },
      { id: 'tool:1', at, type: 'tool', title: 'Read', status: 'completed', result: 'ok', details: 'd' },
      { id: 'delegation:1', at, type: 'delegation', phase: 'started', round: 1, role: 'DEVELOPER', roleName: 'Developer Agent' },
      { id: 'question:1', at, type: 'question', askerRoleName: 'QA Agent', text: 'which?', options: ['x'], number: 1, total: 1 },
      { id: 'sel', at, type: 'selection', text: 'Pick one' },
      message('b'),
    ]);
    seed(historyFile(second), [message('c')]);

    await importAll();

    expect(await recorded()).toEqual(['web-conversations', 'web-histories']);
    expect(await store().history(first)).toEqual([
      message('a'),
      { id: 'steer', at, type: 'notice', level: 'info', text: 'The CEO took a message into the work in progress.' },
      { id: 'thought:1', at, type: 'thought', text: 'hmm', role: 'CEO' },
      { id: 'tool:1', at, type: 'tool', title: 'Read', status: 'completed', result: 'ok', details: 'd', role: 'CEO' },
      { id: 'delegation:1', at, type: 'delegation', delegationId: 'legacy-delegation:1', phase: 'started', round: 1, role: 'DEVELOPER', roleName: 'Developer Agent', summary: '', prompt: '' },
      { id: 'question:1', at, type: 'question', askerRole: 'QA', askerRoleName: 'QA Agent', text: 'which?', options: ['x'], number: 1, total: 1, closed: true },
      { id: 'sel', at, type: 'notice', level: 'warning', text: 'An entry of type "selection" could not be converted to the current format. It read: Pick one' },
      message('b'),
    ]);
    expect(await store().history(second)).toEqual([message('c')]);
    expect(await store().upsertEntry(first, message('d'))).toBe(8);
    expect(exists(historyFile(first))).toBe(false);
    expect(exists(join('web', 'conversations.json'))).toBe(false);
    expect(log).toHaveBeenCalledWith(`legacy_entries_upgraded: ${historyFile(first)}: 5 upgraded, 1 turned into warning notices`);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[Legacy Import] web-histories: 2 histories, 9 entries, 5 upgraded, 1 warnings;'));
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining(`legacy_entries_upgraded: ${historyFile(second)}`));
  });

  it('should recover the files an earlier import left behind when web-conversations is already recorded', async () => {
    const warn = spyWarn();
    await dataSource.getRepository(LegacyImportEntity).insert({ importer: 'web-conversations', importedAt: createdAt, counts: {} });
    await dataSource.query('INSERT INTO conversation (id, title, created_at, updated_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)', [first, 'One', createdAt, createdAt, second, 'Two', createdAt, createdAt]);
    seed('web/conversations.json', [summary('web-other')]);
    seed(historyFile(first), [{ id: 'steer', at, type: 'agent_response', status: 'steered', response: '' }, message('b')]);
    seed(historyFile(second), [message('c')]);

    await importAll();

    expect(await recorded()).toEqual(['web-conversations', 'web-histories']);
    expect(await store().history(first)).toMatchObject([{ id: 'steer', type: 'notice', level: 'info' }, message('b')]);
    expect(await store().history(second)).toEqual([message('c')]);
    expect(exists(historyFile(first))).toBe(false);
    expect(exists(join('web', 'conversations.json'))).toBe(true);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('legacy_file_skipped'));
  });

  it('should put the legacy entries before the entries a conversation gained since an earlier import left the file', async () => {
    await dataSource.getRepository(LegacyImportEntity).insert({ importer: 'web-conversations', importedAt: createdAt, counts: {} });
    await dataSource.query('INSERT INTO conversation (id, title, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?)', [first, 'One', createdAt, '2026-03-03T00:00:00.000Z', '2026-03-04T00:00:00.000Z']);
    await store().upsertEntry(first, message('new-1', 'new 1'));
    await store().upsertEntry(first, message('new-2', 'new 2'));
    await store().upsertEntry(first, message('new-3', 'new 3'));
    seed(historyFile(first), [message('a'), { id: 'steer', at, type: 'agent_response', status: 'steered', response: '' }, message('b')]);

    await importAll();

    expect(await store().history(first)).toMatchObject([message('a'), { id: 'steer', type: 'notice' }, message('b'), message('new-1', 'new 1'), message('new-2', 'new 2'), message('new-3', 'new 3')]);
    expect(await dataSource.query('SELECT entry_id AS id, position FROM conversation_entry WHERE conversation_id = ? ORDER BY position', [first])).toEqual(
      ['a', 'steer', 'b', 'new-1', 'new-2', 'new-3'].map((id, position) => ({ id, position })),
    );
    expect(await store().list()).toEqual([{ ...summary(first), title: 'One', updatedAt: '2026-03-03T00:00:00.000Z', archivedAt: '2026-03-04T00:00:00.000Z' }]);
    expect(exists(historyFile(first))).toBe(false);
    expect(await store().upsertEntry(first, message('next'))).toBe(6);
    expect(await store().upsertEntry(first, message('b', 'edited'))).toBe(2);
  });

  it('should merge into a conversation with many entries without meeting its unique positions', async () => {
    await dataSource.getRepository(LegacyImportEntity).insert({ importer: 'web-conversations', importedAt: createdAt, counts: {} });
    await dataSource.query('INSERT INTO conversation (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', [first, 'One', createdAt, createdAt]);
    const existing = Array.from({ length: 30 }, (_, index) => message(`new-${index}`));
    for (const entry of existing) {
      await store().upsertEntry(first, entry);
    }
    const legacy = [message('a'), message('b')];
    seed(historyFile(first), legacy);

    await importAll();

    expect(await store().history(first)).toEqual([...legacy, ...existing]);
  });

  it('should read the merged history in the same pages as any other', async () => {
    await dataSource.getRepository(LegacyImportEntity).insert({ importer: 'web-conversations', importedAt: createdAt, counts: {} });
    await dataSource.query('INSERT INTO conversation (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', [first, 'One', createdAt, createdAt]);
    const existing = Array.from({ length: 12 }, (_, index) => message(`new-${index}`));
    for (const entry of existing) {
      await store().upsertEntry(first, entry);
    }
    const legacy = Array.from({ length: 391 }, (_, index) => message(`old-${index}`));
    seed(historyFile(first), legacy);

    await importAll();

    const history = await store().history(first);
    const options = { size: HISTORY_PAGE_SIZE, liveDelegations: new Set<string>() };
    const latest = latestPageStart(history, options);
    const earlier = earlierPageStart(history, latest, options);
    expect(history).toEqual([...legacy, ...existing]);
    expect(history.slice(latest)).toEqual([...legacy.slice(latest), ...existing]);
    expect(history.slice(earlier, latest)).toEqual(legacy.slice(earlier, latest));
    expect(earlier).toBeLessThan(latest);
  });

  it('should skip a file whose entries the conversation already holds', async () => {
    const warn = spyWarn();
    await dataSource.getRepository(LegacyImportEntity).insert({ importer: 'web-conversations', importedAt: createdAt, counts: {} });
    await dataSource.query('INSERT INTO conversation (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', [first, 'One', createdAt, createdAt]);
    await store().upsertEntry(first, message('a'));
    await store().upsertEntry(first, message('mine'));
    seed(historyFile(first), [message('old'), message('a', 'older')]);

    await importAll();

    expect(await store().history(first)).toEqual([message('a'), message('mine')]);
    expect(exists(historyFile(first))).toBe(true);
    expect(await recorded()).toEqual(['web-conversations', 'web-histories']);
    expect(warn).toHaveBeenCalledWith(`legacy_file_skipped: ${historyFile(first)} has entries the conversation already holds`);
  });

  it('should not touch a file of no conversation, nor a leftover temporary file', async () => {
    const warn = spyWarn();
    await dataSource.getRepository(LegacyImportEntity).insert({ importer: 'web-conversations', importedAt: createdAt, counts: {} });
    await dataSource.query('INSERT INTO conversation (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', [second, 'Two', createdAt, createdAt]);
    seed(historyFile(second), [message('c')]);
    seed(historyFile('web-orphan'), [message('x')]);
    seed(`${historyFile(second)}.4f2a.tmp`, '[');

    await importAll();

    expect(await store().history(second)).toEqual([message('c')]);
    expect(exists(historyFile('web-orphan'))).toBe(true);
    expect(exists(`${historyFile(second)}.4f2a.tmp`)).toBe(true);
    expect(exists(historyFile(second))).toBe(false);
    expect(warn).toHaveBeenCalledWith(`legacy_file_skipped: ${historyFile('web-orphan')} belongs to no conversation of the database`);
    expect(warn).toHaveBeenCalledWith(`legacy_file_skipped: ${historyFile(second)}.4f2a.tmp is what a write that never finished left behind`);
  });

  it('should leave a file that is not valid JSON or not a list in place, importing the others', async () => {
    const warn = spyWarn();
    seed('web/conversations.json', [summary(first), summary(second)]);
    seed(historyFile(first), '{ broken');
    seed(historyFile(second), '{"not":"a list"}');

    await importAll();

    expect(await recorded()).toEqual(['web-conversations', 'web-histories']);
    expect(await store().history(first)).toEqual([]);
    expect(exists(historyFile(first))).toBe(true);
    expect(exists(historyFile(second))).toBe(true);
    expect(warn).toHaveBeenCalledWith(`legacy_file_skipped: ${historyFile(first)} does not match the format it was written in`);
    expect(warn).toHaveBeenCalledWith(`legacy_file_skipped: ${historyFile(second)} does not match the format it was written in`);
  });

  it('should import an empty history and move its file', async () => {
    seed('web/conversations.json', [summary(first)]);
    seed(historyFile(first), []);

    await importAll();

    expect(await store().history(first)).toEqual([]);
    expect(exists(historyFile(first))).toBe(false);
  });

  it('should import nothing when there is no history directory', async () => {
    const legacy = await histories.read();

    expect(legacy).toMatchObject({ files: [], counts: { histories: 0, entries: 0, upgraded: 0, warnings: 0 } });
  });

  it('should keep one entry per id at its first place with its latest version', async () => {
    seed('web/conversations.json', [summary(first)]);
    seed(historyFile(first), [message('a'), message('b'), message('a', 'edited')]);

    await importAll();

    expect(await store().history(first)).toEqual([message('a', 'edited'), message('b')]);
  });

  it('should give an entry without an id or a time its place in the file and the time of the entry before it', async () => {
    seed('web/conversations.json', [summary(first)]);
    seed(historyFile(first), [{ type: 'interim', text: 'first' }, message('a'), { type: 'interim', text: 'last' }, 7]);

    await importAll();

    expect(await store().history(first)).toMatchObject([
      { id: 'legacy-0', at: createdAt, type: 'interim', text: 'first' },
      message('a'),
      { id: 'legacy-2', at, type: 'interim', text: 'last' },
      { id: 'legacy-3', at, type: 'notice', level: 'warning' },
    ]);
  });

  it('should insert a long history in batches', async () => {
    const entries = Array.from({ length: 1_234 }, (_, index) => message(`e${index}`));
    seed('web/conversations.json', [summary(first)]);
    seed(historyFile(first), entries);

    await importAll();

    expect(await store().history(first)).toEqual(entries);
  });
});
