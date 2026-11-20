import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { createNodeLockedFiles } from '../../storage/testing/node-locked-files.js';
import { buildArtifact } from '../testing/artifact.fixture.js';

import { JsonArtifactStoreAdapter } from './json-artifact-store.adapter.js';


const CONVERSATION = 'channel:thread/1';
const FILE = `${encodeURIComponent(CONVERSATION)}.json`;

describe('JsonArtifactStoreAdapter', () => {
  let directory: string;
  const createStore = (dataDir = directory) => new JsonArtifactStoreAdapter(dataDirectoryAt(dataDir), createNodeLockedFiles());

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'artifacts-'));
  });

  afterEach(() => rm(directory, { recursive: true, force: true }));

  it('should keep one board per conversation, allocating ids per type and reading back what it saved', async () => {
    const store = createStore();

    const ids = await store.transaction(CONVERSATION, (transaction) => {
      const task = buildArtifact({ id: transaction.allocateId('task') });
      const feature = buildArtifact({ id: transaction.allocateId('feature'), type: 'feature' });
      transaction.save(task);
      transaction.save(feature);
      transaction.save(buildArtifact({ id: transaction.allocateId('task') }));
      transaction.remove('T-2');
      return [task.id, feature.id, transaction.find('T-1')?.id, transaction.list().length];
    });
    await store.transaction('web-2', transaction => transaction.save(buildArtifact({ id: transaction.allocateId('task') })));

    expect(ids).toEqual(['T-1', 'F-1', 'T-1', 2]);
    expect((await readdir(join(directory, 'artifacts'))).sort()).toEqual([FILE, 'web-2.json']);
    expect(JSON.parse(await readFile(join(directory, 'artifacts', FILE), 'utf-8'))).toMatchObject({ counters: { T: 2, F: 1 } });

    const reloaded = createStore();
    expect([...await reloaded.conversations()].sort()).toEqual([CONVERSATION, 'web-2']);
    expect((await reloaded.list(CONVERSATION)).map(artifact => artifact.id)).toEqual(['T-1', 'F-1']);
    expect(await reloaded.find(CONVERSATION, 'F-1')).toEqual(buildArtifact({ id: 'F-1', type: 'feature' }));
    expect(await reloaded.find('web-2', 'F-1')).toBeUndefined();
    expect(await reloaded.transaction(CONVERSATION, transaction => transaction.allocateId('task'))).toBe('T-3');
  });

  it('should list a conversation it holds in memory but has not written yet, and none without the directory', async () => {
    const store = createStore();
    expect(await store.conversations()).toEqual([]);

    await store.list('web-1');

    expect(await store.conversations()).toEqual(['web-1']);
  });

  it('should list only the boards among the files of the directory', async () => {
    const store = createStore();
    await store.transaction('web-1', transaction => transaction.save(buildArtifact({ id: 'T-1' })));
    await writeFile(join(directory, 'artifacts', 'web-1.json.lock'), '{}');
    await writeFile(join(directory, 'artifacts', 'web-1.json.0f1e.tmp'), '{}');

    expect(await createStore().conversations()).toEqual(['web-1']);
  });

  it('should never reuse an id already on disk, even without counters', async () => {
    const store = createStore();
    await store.transaction('c', transaction => transaction.save(buildArtifact({ id: 'T-1' })));
    await writeFile(join(directory, 'artifacts', 'c.json'), JSON.stringify({ artifacts: [buildArtifact({ id: 'T-1' }), buildArtifact({ id: 'T-2' })] }));

    expect(await createStore().transaction('c', transaction => transaction.allocateId('task'))).toBe('T-3');
  });

  it('should run every transaction on the board another process changed since this one read it', async () => {
    const store = createStore();
    await store.transaction('c', transaction => transaction.save(buildArtifact({ id: transaction.allocateId('task') })));
    await store.list('c');

    await createStore().transaction('c', transaction => transaction.save(buildArtifact({ id: transaction.allocateId('task') })));
    const allocated = await store.transaction('c', transaction => transaction.allocateId('task'));

    expect(allocated).toBe('T-3');
  });

  it('should keep every artifact that concurrent transactions of this process and another save', async () => {
    const store = createStore();
    const otherProcess = createStore();

    const ids = await Promise.all(Array.from({ length: 8 }, (_, index) => (index % 2 === 0 ? store : otherProcess).transaction('c', (transaction) => {
      const id = transaction.allocateId('task');
      transaction.save(buildArtifact({ id }));
      return id;
    })));

    expect(new Set(ids).size).toBe(8);
    expect((await createStore().list('c')).map(artifact => artifact.id).sort()).toEqual([...ids].sort());
    expect(await readdir(join(directory, 'artifacts'))).toEqual(['c.json']);
  });

  it('should run transactions one at a time and drop the changes of one that throws', async () => {
    const store = createStore();
    const failing = store.transaction('c', (transaction) => {
      transaction.save(buildArtifact({ id: 'T-1' }));
      throw new Error('invalid');
    });
    const next = store.transaction('c', transaction => transaction.list().length);

    await expect(failing).rejects.toThrow('invalid');
    expect(await next).toBe(0);
    expect(await store.list('c')).toEqual([]);
  });

  it('should write nothing for a transaction that changes nothing', async () => {
    const store = createStore();
    await store.transaction('c', transaction => transaction.save(buildArtifact({ id: 'T-1' })));
    const before = await stat(join(directory, 'artifacts', 'c.json'), { bigint: true });

    await expect(store.transaction('c', transaction => transaction.find('T-1')?.id)).resolves.toBe('T-1');

    expect((await stat(join(directory, 'artifacts', 'c.json'), { bigint: true })).ino).toBe(before.ino);
  });

  it('should keep the previous state when the write fails', async () => {
    await writeFile(join(directory, 'blocker'), '');
    const store = createStore(join(directory, 'blocker'));

    await expect(store.transaction('c', transaction => transaction.save(buildArtifact({ id: 'T-1' })))).rejects.toThrow();
    expect(await store.list('c')).toEqual([]);
  });

  it.each([['invalid JSON', '{'], ['an invalid shape', '{"artifacts": [{"id": 1}]}']])('should treat %s as an empty board', async (_name, content) => {
    await mkdir(join(directory, 'artifacts'));
    await writeFile(join(directory, 'artifacts', 'c.json'), content);

    expect(await createStore().list('c')).toEqual([]);
  });
});
