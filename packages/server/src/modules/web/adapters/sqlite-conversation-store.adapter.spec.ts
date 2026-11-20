import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { createInMemoryDataSource } from '../../database/testing/in-memory-data-source.js';

import { SqliteConversationStoreAdapter } from './sqlite-conversation-store.adapter.js';


const message = (id: string, text = id): ConversationEntry => ({ id, at: '2026-01-01T00:00:00.000Z', type: 'user_message', text });

describe('SqliteConversationStoreAdapter', () => {
  let dataSource: DataSource;
  let store: SqliteConversationStoreAdapter;

  beforeEach(async () => {
    dataSource = await createInMemoryDataSource();
    store = new SqliteConversationStoreAdapter(dataSource);
  });

  afterEach(async () => {
    rs.useRealTimers();
    rs.restoreAllMocks();
    await dataSource.destroy();
  });

  it('should create conversations with a web- id and the default title', async () => {
    const summary = await store.create();

    expect(summary.id).toMatch(/^web-[0-9a-f-]{36}$/);
    expect(summary.title).toBe('New conversation');
    expect(summary.createdAt).toBe(summary.updatedAt);
    expect(summary).not.toHaveProperty('archivedAt');
    expect(await store.list()).toEqual([summary]);
    expect(await store.exists(summary.id)).toBe(true);
    expect(await store.exists('web-unknown')).toBe(false);
  });

  it('should list the most recently updated conversation first', async () => {
    rs.useFakeTimers({ toFake: ['Date'] });
    rs.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const first = await store.create();
    rs.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
    const second = await store.create();
    rs.setSystemTime(new Date('2026-01-01T00:00:02.000Z'));

    const touched = await store.touch(first.id);

    expect(touched.updatedAt).toBe('2026-01-01T00:00:02.000Z');
    expect((await store.list()).map(summary => summary.id)).toEqual([first.id, second.id]);
  });

  it('should rename and archive without moving the conversation in the list, and restore it', async () => {
    rs.useFakeTimers({ toFake: ['Date'] });
    rs.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const first = await store.create();
    rs.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
    const second = await store.create();
    rs.setSystemTime(new Date('2026-01-01T00:00:02.000Z'));

    expect(await store.rename(first.id, 'Renamed')).toEqual({ ...first, title: 'Renamed' });
    expect(await store.archive(first.id, true)).toEqual({ ...first, title: 'Renamed', archivedAt: '2026-01-01T00:00:02.000Z' });
    expect((await store.list()).map(summary => summary.id)).toEqual([second.id, first.id]);
    expect(await store.archive(first.id, false)).toEqual({ ...first, title: 'Renamed' });
  });

  it('should reject changes to an unknown conversation', async () => {
    await expect(store.rename('web-unknown', 'x')).rejects.toThrow('Unknown conversation: web-unknown');
    await expect(store.archive('web-unknown', true)).rejects.toThrow('Unknown conversation');
    await expect(store.touch('web-unknown')).rejects.toThrow('Unknown conversation');
    await expect(store.history('web-unknown')).rejects.toThrow('Unknown conversation');
    await expect(store.upsertEntry('web-unknown', message('a'))).rejects.toThrow('Unknown conversation');
  });

  it('should replace an entry by id keeping its position and append new ones', async () => {
    const { id } = await store.create();

    expect(await store.upsertEntry(id, message('a'))).toBe(0);
    expect(await store.upsertEntry(id, message('b'))).toBe(1);
    expect(await store.upsertEntry(id, message('a', 'edited'))).toBe(0);
    expect(await store.upsertEntry(id, message('c'))).toBe(2);

    expect(await store.history(id)).toEqual([message('a', 'edited'), message('b'), message('c')]);
  });

  it('should number the entries of each conversation on their own', async () => {
    const first = await store.create();
    const second = await store.create();

    await store.upsertEntry(first.id, message('a'));
    await store.upsertEntry(first.id, message('b'));

    expect(await store.upsertEntry(second.id, message('a'))).toBe(0);
    expect(await store.history(second.id)).toEqual([message('a')]);
  });

  it('should give every entry written at once its own position', async () => {
    const { id } = await store.create();

    const positions = await Promise.all(['a', 'b', 'c', 'd'].map(entryId => store.upsertEntry(id, message(entryId))));

    expect([...positions].sort()).toEqual([0, 1, 2, 3]);
    expect((await store.history(id)).map(entry => entry.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('should keep what a second store over the same database wrote', async () => {
    const { id } = await store.create();
    await store.upsertEntry(id, message('a'));

    const other = new SqliteConversationStoreAdapter(dataSource);

    expect(await other.list()).toHaveLength(1);
    expect(await other.history(id)).toEqual([message('a')]);
  });

  it('should leave out and log an entry that does not match the protocol', async () => {
    const warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { id } = await store.create();
    await store.upsertEntry(id, message('a'));
    await store.upsertEntry(id, message('b'));
    await store.upsertEntry(id, message('c'));
    await dataSource.query('UPDATE "conversation_entry" SET "payload" = ? WHERE "entry_id" = ?', ['{ broken', 'b']);
    await dataSource.query('UPDATE "conversation_entry" SET "payload" = ? WHERE "entry_id" = ?', ['{"type":"unknown"}', 'c']);

    expect(await store.history(id)).toEqual([message('a')]);
    expect(warn).toHaveBeenCalledWith(`conversation_entry_invalid: ${id}: b`);
    expect(warn).toHaveBeenCalledWith(`conversation_entry_invalid: ${id}: c`);
  });

  it('should have every change written once the call resolves', async () => {
    const { id } = await store.create();
    await store.upsertEntry(id, message('a'));

    await store.flush();

    expect(await dataSource.query('SELECT "entry_id" FROM "conversation_entry"')).toEqual([{ entry_id: 'a' }]);
  });

  it('should drop the history of a conversation with its row', async () => {
    const { id } = await store.create();
    await store.upsertEntry(id, message('a'));

    await dataSource.query('DELETE FROM "conversation" WHERE "id" = ?', [id]);

    expect(await dataSource.query('SELECT COUNT(*) AS "count" FROM "conversation_entry"')).toEqual([{ count: 0 }]);
  });
});
