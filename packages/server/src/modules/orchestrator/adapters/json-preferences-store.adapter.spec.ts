import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JsonPreferencesStoreAdapter } from './json-preferences-store.adapter.js';


describe('JsonPreferencesStoreAdapter', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'json-preferences-'));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('should return empty preferences when nothing was saved', async () => {
    await expect(new JsonPreferencesStoreAdapter(rootDir).load()).resolves.toEqual({});
  });

  it('should persist the language across instances', async () => {
    const dataDir = join(rootDir, 'nested');
    const store = new JsonPreferencesStoreAdapter(dataDir);

    const updated = await store.update({ language: 'Spanish' });

    expect(updated).toEqual({ language: 'Spanish', updatedAt: expect.any(String) });
    await expect(store.load()).resolves.toEqual(updated);
    await expect(new JsonPreferencesStoreAdapter(dataDir).load()).resolves.toEqual(updated);
  });

  it('should keep the last of concurrent updates on disk', async () => {
    const store = new JsonPreferencesStoreAdapter(rootDir);

    await Promise.all([store.update({ language: 'Spanish' }), store.update({ language: 'German' })]);

    expect(JSON.parse(readFileSync(join(rootDir, 'preferences.json'), 'utf-8'))).toMatchObject({ language: 'German' });
  });

  it('should keep writing after a failed write', async () => {
    const blocked = join(rootDir, 'blocked');
    writeFileSync(blocked, '');
    const store = new JsonPreferencesStoreAdapter(blocked);

    await expect(store.update({ language: 'Spanish' })).rejects.toThrow();
    await expect(store.update({ language: 'German' })).rejects.toThrow();
  });

  it('should ignore fields with unexpected types', async () => {
    writeFileSync(join(rootDir, 'preferences.json'), JSON.stringify({ language: 42, updatedAt: '2026-01-01' }));

    await expect(new JsonPreferencesStoreAdapter(rootDir).load()).resolves.toEqual({ updatedAt: '2026-01-01' });
  });

  it('should treat a null or unreadable file as empty', async () => {
    writeFileSync(join(rootDir, 'preferences.json'), 'null');
    await expect(new JsonPreferencesStoreAdapter(rootDir).load()).resolves.toEqual({});

    writeFileSync(join(rootDir, 'preferences.json'), '{broken');
    await expect(new JsonPreferencesStoreAdapter(rootDir).load()).resolves.toEqual({});
  });
});
