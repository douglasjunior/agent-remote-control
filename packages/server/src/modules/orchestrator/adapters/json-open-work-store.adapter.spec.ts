import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { createNodeLockedFiles } from '../../storage/testing/node-locked-files.js';
import type { OpenWork } from '../models/open-work.model.js';

import { JsonOpenWorkStoreAdapter } from './json-open-work-store.adapter.js';


const record: OpenWork = { id: 'd', role: 'DEVELOPER', roleName: 'Dev', projectName: null, summary: 'Build', taskSpec: 'Go', cwd: '/w', round: 1, root: false };

describe('JsonOpenWorkStoreAdapter', () => {
  let directory: string;
  const createStore = (dataDir = directory) => new JsonOpenWorkStoreAdapter(dataDirectoryAt(dataDir), createNodeLockedFiles());

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'open-work-'));
  });

  afterEach(() => rm(directory, { recursive: true, force: true }));

  it('should read back what it saved, leaving no temporary file', async () => {
    await createStore(join(directory, 'nested')).update(() => ({ 'web-1': [record] }));

    expect(await createStore(join(directory, 'nested')).load()).toEqual({ 'web-1': [record] });
    expect(await readdir(join(directory, 'nested'))).toEqual(['open-work.json']);
    expect(JSON.parse(await readFile(join(directory, 'nested', 'open-work.json'), 'utf-8'))).toEqual({ 'web-1': [record] });
  });

  it('should keep the conversations that concurrent updates change, from this process and another', async () => {
    const store = createStore();
    const otherProcess = createStore();

    await Promise.all(['web-1', 'web-2', 'web-3', 'web-4'].map((conversationId, index) =>
      (index % 2 === 0 ? store : otherProcess).update(work => ({ ...work, [conversationId]: [record] }))));

    expect(Object.keys(await createStore().load()).sort()).toEqual(['web-1', 'web-2', 'web-3', 'web-4']);
  });

  it.each([['invalid JSON', '{'], ['a list', '[]'], ['null', 'null']])('should treat %s as empty', async (_name, content) => {
    await writeFile(join(directory, 'open-work.json'), content);

    expect(await createStore().load()).toEqual({});
  });

  it('should treat a missing file as empty', async () => {
    expect(await createStore().load()).toEqual({});
  });
});
