import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AgentRegistryService } from '../../agent-definitions/services/agent-registry.service.js';
import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';
import { FileLockTimeoutError } from '../../storage/ports/file-lock.port.js';
import type { ILockedFilesPort } from '../../storage/ports/locked-files.port.js';
import { createNodeLockedFiles } from '../../storage/testing/node-locked-files.js';
import { StubFileLock } from '../../storage/testing/stub-file-lock.js';
import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';

import { JsonAgentSettingsStoreAdapter } from './json-agent-settings-store.adapter.js';


class ExtendedRegistry extends AgentRegistryService {
  override listRoles(): string[] {
    return [...super.listRoles(), 'DESIGNER'];
  }
}

const registry = new AgentRegistryService();

const CLAUDE: AgentProfileSettings = {
  agentId: 'claude',
  agentName: 'Claude Code',
  modelId: 'm1',
  modelName: 'Model 1',
  effortId: 'high',
  effortName: 'High',
};

const SETTINGS: AgentSettings = {
  profiles: { CEO: CLAUDE, DEVELOPER: { ...CLAUDE, agentId: 'agy', agentName: 'Antigravity' } },
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('JsonAgentSettingsStoreAdapter', () => {
  let rootDir: string;
  const createStore = (dataDir = rootDir, files: ILockedFilesPort = createNodeLockedFiles(), agentRegistry = registry) =>
    new JsonAgentSettingsStoreAdapter(agentRegistry, dataDirectoryAt(dataDir), files);
  const settingsFile = () => join(rootDir, 'agent-settings.json');

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'json-agent-settings-'));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('should return null when nothing was saved', async () => {
    await expect(createStore().load('conv')).resolves.toBeNull();
  });

  it('should persist settings across instances', async () => {
    const dataDir = join(rootDir, 'nested');
    const store = createStore(dataDir);

    await expect(store.update('conv', () => SETTINGS)).resolves.toEqual(SETTINGS);

    await expect(store.load('conv')).resolves.toEqual(SETTINGS);
    await expect(createStore(dataDir).load('conv')).resolves.toEqual(SETTINGS);
  });

  it('should keep settings isolated per conversation', async () => {
    const store = createStore();
    const copilot: AgentSettings = { ...SETTINGS, profiles: { CEO: { ...CLAUDE, agentId: 'copilot' } } };

    await store.update('ch:thread-1', () => SETTINGS);
    await store.update('ch:thread-2', () => copilot);
    await store.update('dm', () => SETTINGS);

    await expect(store.load('ch:thread-1')).resolves.toEqual(SETTINGS);
    await expect(store.load('ch:thread-2')).resolves.toEqual(copilot);
    await expect(store.load('dm')).resolves.toEqual(SETTINGS);
    await expect(store.load('ch')).resolves.toBeNull();
    await expect(createStore().load('ch:thread-1')).resolves.toEqual(SETTINGS);
  });

  it('should resolve an update that stores nothing for a conversation without settings to null', async () => {
    await expect(createStore().update('conv', () => null)).resolves.toBeNull();
  });

  it('should hand an update the own and the most recent settings, and write nothing when it returns null', async () => {
    const store = createStore();
    const newer = { ...SETTINGS, updatedAt: '2026-02-01T00:00:00.000Z' };
    await store.update('conv-1', () => SETTINGS);
    await store.update('conv-2', () => newer);
    const before = readFileSync(settingsFile(), 'utf-8');
    const seen: unknown[] = [];

    await expect(store.update('conv-1', (own, mostRecent) => {
      seen.push(own, mostRecent);
      return null;
    })).resolves.toEqual(SETTINGS);

    expect(seen).toEqual([SETTINGS, newer]);
    expect(readFileSync(settingsFile(), 'utf-8')).toBe(before);
  });

  it('should keep four concurrent profile changes to different roles of one conversation', async () => {
    const store = createStore();
    const roles = ['CEO', 'DEVELOPER', 'QA', 'TECH_LEAD'];

    await Promise.all(roles.map(role => store.update('conv', own => ({
      profiles: { ...own?.profiles, [role]: { ...CLAUDE, agentId: `agent-${role}` } },
      updatedAt: '2026-01-01T00:00:00.000Z',
    }))));

    const stored = JSON.parse(readFileSync(settingsFile(), 'utf-8')) as Record<string, AgentSettings>;
    expect(Object.keys(stored.conv!.profiles).sort()).toEqual([...roles].sort());
    expect(Object.keys((await createStore().load('conv'))!.profiles).sort()).toEqual([...roles].sort());
  });

  it('should keep the changes of two processes that write the same file at once', async () => {
    const first = createStore();
    const second = createStore();

    await Promise.all([
      ...['CEO', 'QA'].map(role => first.update('conv', own => ({ profiles: { ...own?.profiles, [role]: CLAUDE }, updatedAt: 'a' }))),
      ...['DEVELOPER', 'GIT_OPS'].map(role => second.update('conv', own => ({ profiles: { ...own?.profiles, [role]: CLAUDE }, updatedAt: 'b' }))),
    ]);

    expect(Object.keys((await first.load('conv'))!.profiles).sort()).toEqual(['CEO', 'DEVELOPER', 'GIT_OPS', 'QA']);
    expect(readdirSync(rootDir)).toEqual(['agent-settings.json']);
  });

  it('should reject an update that cannot take the lock and leave the file as it was', async () => {
    const lock = new StubFileLock();
    const store = createStore(rootDir, createNodeLockedFiles(lock));
    await store.update('conv', () => SETTINGS);
    lock.failNext = new FileLockTimeoutError(`${settingsFile()}.lock`, 15_000);

    await expect(store.update('conv', () => ({ ...SETTINGS, updatedAt: 'later' }))).rejects.toBeInstanceOf(FileLockTimeoutError);

    await expect(createStore().load('conv')).resolves.toEqual(SETTINGS);
    expect(lock.lockPaths).toEqual([`${settingsFile()}.lock`, `${settingsFile()}.lock`]);
  });

  it('should replace a file that is not valid JSON on the next update', async () => {
    writeFileSync(settingsFile(), '{not json');

    await createStore().update('conv', () => SETTINGS);

    expect(JSON.parse(readFileSync(settingsFile(), 'utf-8'))).toEqual({ conv: SETTINGS });
  });

  it('should return null for loadMostRecent when store is empty', async () => {
    await expect(createStore().loadMostRecent()).resolves.toBeNull();
  });

  it('should return the most recently updated settings', async () => {
    const store = createStore();
    const older = { ...SETTINGS, updatedAt: '2026-01-01T10:00:00.000Z' };
    const newer = { ...SETTINGS, profiles: { CEO: CLAUDE }, updatedAt: '2026-01-02T10:00:00.000Z' };

    await store.update('conv-1', () => older);
    await store.update('conv-2', () => newer);

    await expect(store.loadMostRecent()).resolves.toEqual(newer);
  });

  it('should migrate a legacy flat record to every role', async () => {
    const legacy = { ...CLAUDE, updatedAt: '2026-01-01T00:00:00.000Z' };
    writeFileSync(settingsFile(), JSON.stringify({ conv: legacy }));

    const loaded = await createStore().load('conv');

    expect(Object.keys(loaded?.profiles ?? {})).toEqual(registry.listRoles());
    expect(Object.values(loaded?.profiles ?? {}).every(profile => profile.agentId === 'claude')).toBe(true);
    expect(loaded?.profiles.CEO).toEqual(CLAUDE);
    expect(loaded?.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('should migrate a legacy flat record to the roles listed by the registry', async () => {
    writeFileSync(settingsFile(), JSON.stringify({ conv: CLAUDE }));

    const loaded = await createStore(rootDir, createNodeLockedFiles(), new ExtendedRegistry()).load('conv');

    expect(Object.keys(loaded?.profiles ?? {})).toEqual([...registry.listRoles(), 'DESIGNER']);
  });

  it('should normalize missing optional fields of a legacy record', async () => {
    writeFileSync(settingsFile(), JSON.stringify({ conv: { agentId: 'claude' } }));

    const loaded = await createStore().load('conv');

    expect(loaded?.updatedAt).toBe('');
    expect(loaded?.profiles.GIT_OPS).toEqual({
      agentId: 'claude',
      agentName: 'claude',
      modelId: null,
      modelName: null,
      effortId: null,
      effortName: null,
    });
  });

  it('should drop invalid profiles from the new format and keep the valid ones', async () => {
    writeFileSync(
      settingsFile(),
      JSON.stringify({
        conv: { profiles: { CEO: { agentId: 'claude' }, DEVELOPER: { modelId: 'm1' }, GIT_OPS: null } },
      }),
    );

    const loaded = await createStore().load('conv');

    expect(Object.keys(loaded?.profiles ?? {})).toEqual(['CEO']);
    expect(loaded?.profiles.CEO.agentName).toBe('claude');
    expect(loaded?.updatedAt).toBe('');
  });

  it.each([
    ['invalid JSON', '{not json'],
    ['null', 'null'],
    ['legacy global settings', JSON.stringify({ agentId: 'claude', modelId: 'm1' })],
    ['missing agent', JSON.stringify({ conv: { modelId: 'm1' } })],
    ['non-string agent', JSON.stringify({ conv: { agentId: 42 } })],
    ['null entry', JSON.stringify({ conv: null })],
    ['no valid profiles', JSON.stringify({ conv: { profiles: { CEO: { modelId: 'm1' } } } })],
    ['empty profiles', JSON.stringify({ conv: { profiles: {} } })],
  ])('should return null for %s', async (_label, content) => {
    writeFileSync(settingsFile(), content);

    await expect(createStore().load('conv')).resolves.toBeNull();
  });
});
