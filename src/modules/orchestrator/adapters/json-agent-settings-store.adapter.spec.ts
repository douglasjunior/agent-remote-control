import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AGENT_ROLES } from '../../agent-definitions/models/agent-role.type.js';
import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';

import { JsonAgentSettingsStoreAdapter } from './json-agent-settings-store.adapter.js';


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

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'json-agent-settings-'));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('should return null when nothing was saved', async () => {
    await expect(new JsonAgentSettingsStoreAdapter(rootDir).load('conv')).resolves.toBeNull();
  });

  it('should persist settings across instances', async () => {
    const dataDir = join(rootDir, 'nested');
    const store = new JsonAgentSettingsStoreAdapter(dataDir);

    await store.save('conv', SETTINGS);

    await expect(store.load('conv')).resolves.toEqual(SETTINGS);
    await expect(new JsonAgentSettingsStoreAdapter(dataDir).load('conv')).resolves.toEqual(SETTINGS);
  });

  it('should keep settings isolated per conversation', async () => {
    const store = new JsonAgentSettingsStoreAdapter(rootDir);
    const copilot: AgentSettings = { ...SETTINGS, profiles: { CEO: { ...CLAUDE, agentId: 'copilot' } } };

    await store.save('ch:thread-1', SETTINGS);
    await store.save('ch:thread-2', copilot);
    await store.save('dm', SETTINGS);

    await expect(store.load('ch:thread-1')).resolves.toEqual(SETTINGS);
    await expect(store.load('ch:thread-2')).resolves.toEqual(copilot);
    await expect(store.load('dm')).resolves.toEqual(SETTINGS);
    await expect(store.load('ch')).resolves.toBeNull();
    const reloaded = new JsonAgentSettingsStoreAdapter(rootDir);
    await expect(reloaded.load('ch:thread-1')).resolves.toEqual(SETTINGS);
  });

  it('should return null for loadMostRecent when store is empty', async () => {
    const store = new JsonAgentSettingsStoreAdapter(rootDir);
    await expect(store.loadMostRecent()).resolves.toBeNull();
  });

  it('should return the most recently updated settings', async () => {
    const store = new JsonAgentSettingsStoreAdapter(rootDir);
    const older = { ...SETTINGS, updatedAt: '2026-01-01T10:00:00.000Z' };
    const newer = { ...SETTINGS, profiles: { CEO: CLAUDE }, updatedAt: '2026-01-02T10:00:00.000Z' };

    await store.save('conv-1', older);
    await store.save('conv-2', newer);

    await expect(store.loadMostRecent()).resolves.toEqual(newer);
  });

  it('should migrate a legacy flat record to every role', async () => {
    const legacy = { ...CLAUDE, updatedAt: '2026-01-01T00:00:00.000Z' };
    writeFileSync(join(rootDir, 'agent-settings.json'), JSON.stringify({ conv: legacy }));

    const loaded = await new JsonAgentSettingsStoreAdapter(rootDir).load('conv');

    expect(Object.keys(loaded?.profiles ?? {})).toEqual([...AGENT_ROLES]);
    expect(Object.values(loaded?.profiles ?? {}).every(profile => profile.agentId === 'claude')).toBe(true);
    expect(loaded?.profiles.CEO).toEqual(CLAUDE);
    expect(loaded?.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('should normalize missing optional fields of a legacy record', async () => {
    writeFileSync(join(rootDir, 'agent-settings.json'), JSON.stringify({ conv: { agentId: 'claude' } }));

    const loaded = await new JsonAgentSettingsStoreAdapter(rootDir).load('conv');

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
      join(rootDir, 'agent-settings.json'),
      JSON.stringify({
        conv: { profiles: { CEO: { agentId: 'claude' }, DEVELOPER: { modelId: 'm1' }, GIT_OPS: null } },
      }),
    );

    const loaded = await new JsonAgentSettingsStoreAdapter(rootDir).load('conv');

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
    writeFileSync(join(rootDir, 'agent-settings.json'), content);

    await expect(new JsonAgentSettingsStoreAdapter(rootDir).load('conv')).resolves.toBeNull();
  });
});
