import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import type { OpenWork } from '../models/open-work.model.js';

import { JsonOpenWorkStoreAdapter } from './json-open-work-store.adapter.js';


const record: OpenWork = { id: 'd', role: 'DEVELOPER', roleName: 'Dev', projectName: null, summary: 'Build', taskSpec: 'Go', cwd: '/w', round: 1, root: false };

describe('JsonOpenWorkStoreAdapter', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'open-work-'));
  });

  afterEach(() => rm(directory, { recursive: true, force: true }));

  it('reads back what it saved, leaving no temporary file', async () => {
    await new JsonOpenWorkStoreAdapter(dataDirectoryAt(join(directory, 'nested'))).save({ 'web-1': [record] });

    expect(await new JsonOpenWorkStoreAdapter(dataDirectoryAt(join(directory, 'nested'))).load()).toEqual({ 'web-1': [record] });
    expect(await readdir(join(directory, 'nested'))).toEqual(['open-work.json']);
    expect(JSON.parse(await readFile(join(directory, 'nested', 'open-work.json'), 'utf-8'))).toEqual({ 'web-1': [record] });
  });

  it.each([['invalid JSON', '{'], ['a list', '[]'], ['null', 'null']])('treats %s as empty', async (_name, content) => {
    await writeFile(join(directory, 'open-work.json'), content);

    expect(await new JsonOpenWorkStoreAdapter(dataDirectoryAt(directory)).load()).toEqual({});
  });

  it('treats a missing file as empty', async () => {
    expect(await new JsonOpenWorkStoreAdapter(dataDirectoryAt(directory)).load()).toEqual({});
  });
});
