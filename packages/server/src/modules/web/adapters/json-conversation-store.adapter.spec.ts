import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


import { JsonConversationStoreAdapter } from './json-conversation-store.adapter.js';


const at = '2026-01-01T00:00:00.000Z';
const note = (id: string, text = id): ConversationEntry => ({ id, at, type: 'interim', text });

describe('JsonConversationStoreAdapter', () => {
  let dataDir: string;
  let store: JsonConversationStoreAdapter;
  const webDir = () => join(dataDir, 'web');

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'conversation-store-'));
    store = new JsonConversationStoreAdapter(dataDir);
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates conversations with a web- id and the default title', async () => {
    const summary = await store.create();

    expect(summary.id).toMatch(/^web-[0-9a-f-]{36}$/);
    expect(summary.title).toBe('New conversation');
    expect(await store.exists(summary.id)).toBe(true);
    expect(await store.exists('web-other')).toBe(false);
  });

  it('lists the most recently updated conversation first', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const first = await store.create();
    vi.setSystemTime(new Date('2026-01-01T00:00:01Z'));
    const second = await store.create();
    vi.setSystemTime(new Date('2026-01-01T00:00:02Z'));
    await store.touch(first.id);

    expect((await store.list()).map(summary => summary.id)).toEqual([first.id, second.id]);
  });

  it('renames a conversation and rejects unknown ones', async () => {
    const { id } = await store.create();

    expect((await store.rename(id, 'Fix the bug')).title).toBe('Fix the bug');
    await expect(store.rename('web-missing', 'x')).rejects.toThrow('Unknown conversation');
    await expect(store.touch('web-missing')).rejects.toThrow('Unknown conversation');
  });

  it('replaces an entry by id keeping its position and appends new ones', async () => {
    const { id } = await store.create();

    await store.upsertEntry(id, note('a', 'first'));
    await store.upsertEntry(id, note('b'));
    await store.upsertEntry(id, note('a', 'changed'));

    expect(await store.history(id)).toEqual([note('a', 'changed'), note('b')]);
  });

  it('does not touch the file system for ids it does not know', async () => {
    await expect(store.history('../../etc/passwd')).rejects.toThrow('Unknown conversation');
    await expect(store.upsertEntry('web-missing', note('a'))).rejects.toThrow('Unknown conversation');
  });

  it('writes the files after the debounce interval', async () => {
    vi.useFakeTimers();
    const { id } = await store.create();
    await store.upsertEntry(id, note('a'));
    expect(() => readFileSync(join(webDir(), 'conversations.json'))).toThrow();

    await vi.advanceTimersByTimeAsync(1_000);
    await store.onModuleDestroy();

    expect(JSON.parse(readFileSync(join(webDir(), 'conversations.json'), 'utf-8'))).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(webDir(), 'history', `${id}.json`), 'utf-8'))).toEqual([note('a')]);
    expect(readdirSync(join(webDir(), 'history')).every(file => !file.endsWith('.tmp'))).toBe(true);
  });

  it('coalesces many updates into one write', async () => {
    vi.useFakeTimers();
    const { id } = await store.create();

    for (let index = 0; index < 5; index += 1) {
      await store.upsertEntry(id, note('a', `v${index}`));
    }
    await vi.advanceTimersByTimeAsync(1_000);
    await store.onModuleDestroy();

    expect(JSON.parse(readFileSync(join(webDir(), 'history', `${id}.json`), 'utf-8'))).toEqual([note('a', 'v4')]);
  });

  it('flushes immediately on request and on module destroy', async () => {
    const first = await store.create();
    await store.upsertEntry(first.id, note('a'));
    await store.flush(first.id);
    expect(JSON.parse(readFileSync(join(webDir(), 'history', `${first.id}.json`), 'utf-8'))).toEqual([note('a')]);

    await store.upsertEntry(first.id, note('b'));
    await store.onModuleDestroy();
    expect(JSON.parse(readFileSync(join(webDir(), 'history', `${first.id}.json`), 'utf-8'))).toHaveLength(2);
  });

  it('flushing a conversation without pending changes does nothing', async () => {
    const { id } = await store.create();
    await store.flush(id);
    await store.flush(id);

    expect(JSON.parse(readFileSync(join(webDir(), 'conversations.json'), 'utf-8'))).toHaveLength(1);
  });

  it('reloads conversations and history written by an earlier instance', async () => {
    const { id } = await store.create();
    await store.upsertEntry(id, note('a'));
    await store.onModuleDestroy();

    const reloaded = new JsonConversationStoreAdapter(dataDir);

    expect((await reloaded.list()).map(summary => summary.id)).toEqual([id]);
    expect(await reloaded.history(id)).toEqual([note('a')]);
  });

  it('ignores files that do not match the protocol', async () => {
    mkdirSync(join(webDir(), 'history'), { recursive: true });
    const summary = { id: 'web-1', title: 'T', createdAt: at, updatedAt: at };
    writeFileSync(join(webDir(), 'conversations.json'), JSON.stringify([summary]));
    writeFileSync(join(webDir(), 'history', 'web-1.json'), JSON.stringify([{ type: 'nope' }]));

    expect(await store.history('web-1')).toEqual([]);
    writeFileSync(join(webDir(), 'conversations.json'), JSON.stringify({ not: 'a list' }));
    expect(await new JsonConversationStoreAdapter(dataDir).list()).toEqual([]);
    writeFileSync(join(webDir(), 'conversations.json'), '{ broken');
    expect(await new JsonConversationStoreAdapter(dataDir).list()).toEqual([]);
  });

  it('keeps working when a write fails', async () => {
    const { id } = await store.create();
    writeFileSync(join(dataDir, 'web'), 'a file where the directory should be');
    await store.upsertEntry(id, note('a'));

    await expect(store.flush(id)).resolves.toBeUndefined();
  });
});
