import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { buildArtifact } from '../testing/artifact.fixture.js';

import { JsonArtifactStoreAdapter } from './json-artifact-store.adapter.js';


const CONVERSATION = 'channel:thread/1';
const FILE = `${encodeURIComponent(CONVERSATION)}.json`;

describe('JsonArtifactStoreAdapter', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'artifacts-'));
  });

  afterEach(() => rm(directory, { recursive: true, force: true }));

  it('keeps one board per conversation, allocating ids per type and reading back what it saved', async () => {
    const store = new JsonArtifactStoreAdapter(dataDirectoryAt(directory));

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

    const reloaded = new JsonArtifactStoreAdapter(dataDirectoryAt(directory));
    expect([...await reloaded.conversations()].sort()).toEqual([CONVERSATION, 'web-2']);
    expect((await reloaded.list(CONVERSATION)).map(artifact => artifact.id)).toEqual(['T-1', 'F-1']);
    expect(await reloaded.find(CONVERSATION, 'F-1')).toEqual(buildArtifact({ id: 'F-1', type: 'feature' }));
    expect(await reloaded.find('web-2', 'F-1')).toBeUndefined();
    expect(await reloaded.transaction(CONVERSATION, transaction => transaction.allocateId('task'))).toBe('T-3');
  });

  it('lists a conversation it holds in memory but has not written yet, and none without the directory', async () => {
    const store = new JsonArtifactStoreAdapter(dataDirectoryAt(directory));
    expect(await store.conversations()).toEqual([]);

    await store.list('web-1');

    expect(await store.conversations()).toEqual(['web-1']);
  });

  it('never reuses an id already on disk, even without counters', async () => {
    await writeFile(join(directory, 'artifacts'), '');
    await rm(join(directory, 'artifacts'));
    const store = new JsonArtifactStoreAdapter(dataDirectoryAt(directory));
    await store.transaction('c', transaction => transaction.save(buildArtifact({ id: 'T-1' })));
    await writeFile(join(directory, 'artifacts', 'c.json'), JSON.stringify({ artifacts: [buildArtifact({ id: 'T-1' }), buildArtifact({ id: 'T-2' })] }));

    expect(await new JsonArtifactStoreAdapter(dataDirectoryAt(directory)).transaction('c', transaction => transaction.allocateId('task'))).toBe('T-3');
  });

  it('runs transactions one at a time and drops the changes of one that throws', async () => {
    const store = new JsonArtifactStoreAdapter(dataDirectoryAt(directory));
    const failing = store.transaction('c', (transaction) => {
      transaction.save(buildArtifact({ id: 'T-1' }));
      throw new Error('invalid');
    });
    const next = store.transaction('c', transaction => transaction.list().length);

    await expect(failing).rejects.toThrow('invalid');
    expect(await next).toBe(0);
    expect(await store.list('c')).toEqual([]);
  });

  it('keeps the previous state when the write fails', async () => {
    await writeFile(join(directory, 'blocker'), '');
    const store = new JsonArtifactStoreAdapter(dataDirectoryAt(join(directory, 'blocker')));

    await expect(store.transaction('c', transaction => transaction.save(buildArtifact({ id: 'T-1' })))).rejects.toThrow();
    expect(await store.list('c')).toEqual([]);
  });

  it.each([['invalid JSON', '{'], ['an invalid shape', '{"artifacts": [{"id": 1}]}']])('treats %s as an empty board', async (_name, content) => {
    const store = new JsonArtifactStoreAdapter(dataDirectoryAt(directory));
    await store.transaction('c', () => undefined);
    await writeFile(join(directory, 'artifacts', 'c.json'), content);

    expect(await new JsonArtifactStoreAdapter(dataDirectoryAt(directory)).list('c')).toEqual([]);
  });
});
