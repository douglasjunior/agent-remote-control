import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Logger } from '@nestjs/common';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { NodeFileLockAdapter } from '../../storage/adapters/node-file-lock.adapter.js';
import { FileLockTimeoutError } from '../../storage/ports/file-lock.port.js';
import type { ILockedFilesPort } from '../../storage/ports/locked-files.port.js';
import { createNodeLockedFiles } from '../../storage/testing/node-locked-files.js';
import { StubFileLock } from '../../storage/testing/stub-file-lock.js';

import { JsonConversationStoreAdapter } from './json-conversation-store.adapter.js';


const at = '2026-01-01T00:00:00.000Z';
const note = (id: string, text = id): ConversationEntry => ({ id, at, type: 'interim', text });

describe('JsonConversationStoreAdapter', () => {
  let dataDir: string;
  let store: JsonConversationStoreAdapter;
  const webDir = () => join(dataDir, 'web');
  const createStore = (files: ILockedFilesPort = createNodeLockedFiles()) => new JsonConversationStoreAdapter(dataDirectoryAt(dataDir), files);
  const historyOnDisk = (id: string) => JSON.parse(readFileSync(join(webDir(), 'history', `${id}.json`), 'utf-8')) as ConversationEntry[];

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'conversation-store-'));
    store = createStore();
  });

  afterEach(() => {
    rs.useRealTimers();
    rs.restoreAllMocks();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('should create conversations with a web- id and the default title', async () => {
    const summary = await store.create();

    expect(summary.id).toMatch(/^web-[0-9a-f-]{36}$/);
    expect(summary.title).toBe('New conversation');
    expect(await store.exists(summary.id)).toBe(true);
    expect(await store.exists('web-other')).toBe(false);
  });

  it('should list the most recently updated conversation first', async () => {
    rs.useFakeTimers({ toFake: ['Date'] });
    rs.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const first = await store.create();
    rs.setSystemTime(new Date('2026-01-01T00:00:01Z'));
    const second = await store.create();
    rs.setSystemTime(new Date('2026-01-01T00:00:02Z'));
    await store.touch(first.id);

    expect((await store.list()).map(summary => summary.id)).toEqual([first.id, second.id]);
  });

  it('should rename and archive without moving the conversation in the list, and restore it', async () => {
    rs.useFakeTimers({ now: new Date('2026-03-01T10:00:00.000Z') });
    const { id, updatedAt } = await store.create();
    rs.setSystemTime(new Date('2026-03-02T10:00:00.000Z'));

    expect(await store.rename(id, 'Renamed')).toMatchObject({ title: 'Renamed', updatedAt });
    expect(await store.archive(id, true)).toMatchObject({ archivedAt: '2026-03-02T10:00:00.000Z', updatedAt });
    expect(await store.archive(id, false)).not.toHaveProperty('archivedAt');
    expect((await store.touch(id)).updatedAt).toBe('2026-03-02T10:00:00.000Z');
    await expect(store.archive('web-missing', true)).rejects.toThrow('Unknown conversation');
  });

  it('should rename a conversation and reject unknown ones', async () => {
    const { id } = await store.create();

    expect((await store.rename(id, 'Fix the bug')).title).toBe('Fix the bug');
    await expect(store.rename('web-missing', 'x')).rejects.toThrow('Unknown conversation');
    await expect(store.touch('web-missing')).rejects.toThrow('Unknown conversation');
  });

  it('should replace an entry by id keeping its position and append new ones', async () => {
    const { id } = await store.create();

    const positions = [
      await store.upsertEntry(id, note('a', 'first')),
      await store.upsertEntry(id, note('b')),
      await store.upsertEntry(id, note('a', 'changed')),
    ];

    expect(positions).toEqual([0, 1, 0]);
    expect(await store.history(id)).toEqual([note('a', 'changed'), note('b')]);
  });

  it('should not touch the file system for ids it does not know', async () => {
    await expect(store.history('../../etc/passwd')).rejects.toThrow('Unknown conversation');
    await expect(store.upsertEntry('web-missing', note('a'))).rejects.toThrow('Unknown conversation');
  });

  it('should write the files after the debounce interval', async () => {
    rs.useFakeTimers();
    const { id } = await store.create();
    await store.upsertEntry(id, note('a'));
    expect(() => readFileSync(join(webDir(), 'conversations.json'))).toThrow();

    await rs.advanceTimersByTimeAsync(1_000);
    await store.onModuleDestroy();

    expect(JSON.parse(readFileSync(join(webDir(), 'conversations.json'), 'utf-8'))).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(webDir(), 'history', `${id}.json`), 'utf-8'))).toEqual([note('a')]);
    expect(readdirSync(join(webDir(), 'history')).every(file => !file.endsWith('.tmp'))).toBe(true);
  });

  it('should coalesce many updates into one write', async () => {
    rs.useFakeTimers();
    const { id } = await store.create();

    for (let index = 0; index < 5; index += 1) {
      await store.upsertEntry(id, note('a', `v${index}`));
    }
    await rs.advanceTimersByTimeAsync(1_000);
    await store.onModuleDestroy();

    expect(JSON.parse(readFileSync(join(webDir(), 'history', `${id}.json`), 'utf-8'))).toEqual([note('a', 'v4')]);
  });

  it('should flush immediately on request and on module destroy', async () => {
    const first = await store.create();
    await store.upsertEntry(first.id, note('a'));
    await store.flush(first.id);
    expect(JSON.parse(readFileSync(join(webDir(), 'history', `${first.id}.json`), 'utf-8'))).toEqual([note('a')]);

    await store.upsertEntry(first.id, note('b'));
    await store.onModuleDestroy();
    expect(JSON.parse(readFileSync(join(webDir(), 'history', `${first.id}.json`), 'utf-8'))).toHaveLength(2);
  });

  it('should do nothing when flushing a conversation without pending changes', async () => {
    const { id } = await store.create();
    await store.flush(id);
    await store.flush(id);

    expect(JSON.parse(readFileSync(join(webDir(), 'conversations.json'), 'utf-8'))).toHaveLength(1);
  });

  it('should reload conversations and history written by an earlier instance', async () => {
    const { id } = await store.create();
    await store.upsertEntry(id, note('a'));
    await store.onModuleDestroy();

    const reloaded = createStore();

    expect((await reloaded.list()).map(summary => summary.id)).toEqual([id]);
    expect(await reloaded.history(id)).toEqual([note('a')]);
  });

  it('should ignore files that do not match the protocol', async () => {
    mkdirSync(join(webDir(), 'history'), { recursive: true });
    const summary = { id: 'web-1', title: 'T', createdAt: at, updatedAt: at };
    writeFileSync(join(webDir(), 'conversations.json'), JSON.stringify([summary]));
    writeFileSync(join(webDir(), 'history', 'web-1.json'), JSON.stringify([{ type: 'nope' }]));

    expect(await store.history('web-1')).toEqual([]);
    writeFileSync(join(webDir(), 'conversations.json'), JSON.stringify({ not: 'a list' }));
    expect(await createStore().list()).toEqual([]);
    writeFileSync(join(webDir(), 'conversations.json'), '{ broken');
    expect(await createStore().list()).toEqual([]);
  });

  it('should keep working when a write fails', async () => {
    const { id } = await store.create();
    writeFileSync(join(dataDir, 'web'), 'a file where the directory should be');
    await store.upsertEntry(id, note('a'));

    await expect(store.flush(id)).resolves.toBeUndefined();
  });

  it('should count the position of a new entry after the stored ones and the new ones waiting before it', async () => {
    const { id } = await store.create();
    await store.upsertEntry(id, note('a'));
    await store.upsertEntry(id, note('b'));
    await store.flush(id);

    const positions = [
      await store.upsertEntry(id, note('c')),
      await store.upsertEntry(id, note('a', 'changed')),
      await store.upsertEntry(id, note('d')),
      await store.upsertEntry(id, note('c', 'changed')),
    ];

    expect(positions).toEqual([2, 0, 3, 2]);
    expect(await store.history(id)).toEqual([note('a', 'changed'), note('b'), note('c', 'changed'), note('d')]);
  });

  it('should keep the entries two processes write to one history at once', async () => {
    const { id } = await store.create();
    await store.flush(id);
    const otherProcess = createStore();

    await Promise.all([store.upsertEntry(id, note('a')), otherProcess.upsertEntry(id, note('b'))]);
    await Promise.all([store.flush(id), otherProcess.flush(id)]);

    expect(historyOnDisk(id).map(entry => entry.id).sort()).toEqual(['a', 'b']);
    expect((await createStore().history(id)).map(entry => entry.id).sort()).toEqual(['a', 'b']);
    expect(readdirSync(join(webDir(), 'history'))).toEqual([`${id}.json`]);
  });

  it('should keep the conversations and changes two processes write to the list at once', async () => {
    const first = await store.create();
    await store.flush(first.id);
    const otherProcess = createStore();

    const [second] = await Promise.all([otherProcess.create(), store.rename(first.id, 'Renamed here')]);
    await otherProcess.touch(first.id);
    await Promise.all([store.flush(first.id), otherProcess.flush(second.id)]);

    const reloaded = await createStore().list();
    expect(reloaded.map(summary => summary.id).sort()).toEqual([first.id, second.id].sort());
    expect(reloaded.find(summary => summary.id === first.id)?.title).toBe('Renamed here');
  });

  it('should see a history another process wrote since this one last read it', async () => {
    const { id } = await store.create();
    await store.upsertEntry(id, note('a'));
    await store.flush(id);
    expect(await store.history(id)).toEqual([note('a')]);

    const otherProcess = createStore();
    await otherProcess.upsertEntry(id, note('b'));
    await otherProcess.flush(id);

    expect(await store.history(id)).toEqual([note('a'), note('b')]);
  });

  it('should log a write that cannot take the lock and write its changes with the next flush', async () => {
    const error = rs.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const lock = new StubFileLock();
    const locked = createStore(createNodeLockedFiles(lock));
    const { id } = await locked.create();
    await locked.upsertEntry(id, note('a'));
    const lockPath = join(webDir(), 'history', `${id}.json.lock`);
    lock.failNext = new FileLockTimeoutError(lockPath, 15_000);

    await locked.flush(id);

    expect(error).toHaveBeenCalledWith(`conversation_store_write_failed: ${id}: Timed out after 15000ms waiting for the lock ${lockPath}`);
    expect(await locked.history(id)).toEqual([note('a')]);
    await locked.flush(id);
    expect(historyOnDisk(id)).toEqual([note('a')]);
  });

  it('should describe a failed write that is not an Error', async () => {
    const error = rs.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const lock = new StubFileLock();
    const locked = createStore(createNodeLockedFiles(lock));
    const { id } = await locked.create();
    lock.withLock = async () => Promise.reject('denied');

    await locked.flush(id);

    expect(error).toHaveBeenCalledWith('conversation_store_write_failed: conversations: denied');
  });

  it('should keep the changes made while a write is in progress waiting for the next one', async () => {
    const lock = new NodeFileLockAdapter();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holdNext = false;
    const withLock = lock.withLock.bind(lock);
    lock.withLock = async (lockPath, work, options) => withLock(lockPath, async () => {
      const result = await work();
      if (holdNext) {
        holdNext = false;
        await held;
      }
      return result;
    }, options);
    const locked = createStore(createNodeLockedFiles(lock));
    const { id } = await locked.create();
    await locked.flush(id);
    holdNext = true;
    await locked.upsertEntry(id, note('a'));
    const first = locked.flush(id);
    await rs.waitFor(() => expect(historyOnDisk(id)).toEqual([note('a')]));

    await locked.upsertEntry(id, note('a', 'changed'));
    await locked.upsertEntry(id, note('b'));
    const second = locked.flush(id);
    release();
    await Promise.all([first, second]);

    expect(historyOnDisk(id)).toEqual([note('a', 'changed'), note('b')]);
    await locked.flush(id);
    expect(await createStore().history(id)).toEqual([note('a', 'changed'), note('b')]);
  });
});
