import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { createNodeLockedFiles } from '../../storage/testing/node-locked-files.js';

import { JsonPreferencesStoreAdapter } from './json-preferences-store.adapter.js';


describe('JsonPreferencesStoreAdapter', () => {
  let rootDir: string;
  const createStore = (dataDir = rootDir) => new JsonPreferencesStoreAdapter(dataDirectoryAt(dataDir), createNodeLockedFiles());

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'json-preferences-'));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('should return empty preferences when nothing was saved', async () => {
    await expect(createStore().load()).resolves.toEqual({});
  });

  it('should persist the language across instances', async () => {
    const dataDir = join(rootDir, 'nested');
    const store = createStore(dataDir);

    const updated = await store.update(() => ({ language: 'Spanish' }));

    expect(updated).toEqual({ language: 'Spanish', updatedAt: expect.any(String) });
    await expect(store.load()).resolves.toEqual(updated);
    await expect(createStore(dataDir).load()).resolves.toEqual(updated);
  });

  it('should keep the last of concurrent updates on disk', async () => {
    const store = createStore();

    await Promise.all([store.update(() => ({ language: 'Spanish' })), store.update(() => ({ language: 'German' }))]);

    expect(JSON.parse(readFileSync(join(rootDir, 'preferences.json'), 'utf-8'))).toMatchObject({ language: 'German' });
  });

  it('should keep a language another process stored before a detection that only stores one when none is set', async () => {
    const store = createStore();
    const detected = store.load();
    await createStore().update(() => ({ language: 'Spanish' }));

    expect((await detected).language).toBeUndefined();
    await store.update(current => (current.language ? undefined : { language: 'English' }));

    await expect(createStore().load()).resolves.toMatchObject({ language: 'Spanish' });
  });

  it('should reject every update while the data directory cannot be written', async () => {
    const blocked = join(rootDir, 'blocked');
    writeFileSync(blocked, '');
    const store = createStore(blocked);

    await expect(store.update(() => ({ language: 'Spanish' }))).rejects.toThrow();
    await expect(store.update(() => ({ language: 'German' }))).rejects.toThrow();
  });

  it('should ignore fields with unexpected types', async () => {
    writeFileSync(join(rootDir, 'preferences.json'), JSON.stringify({ language: 42, updatedAt: '2026-01-01' }));

    await expect(createStore().load()).resolves.toEqual({ updatedAt: '2026-01-01' });
  });

  it('should treat a null or unreadable file as empty', async () => {
    writeFileSync(join(rootDir, 'preferences.json'), 'null');
    await expect(createStore().load()).resolves.toEqual({});

    writeFileSync(join(rootDir, 'preferences.json'), '{broken');
    await expect(createStore().load()).resolves.toEqual({});
  });
});
