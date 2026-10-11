import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentSettings } from '../models/agent-settings.model.js';

import { JsonAgentSettingsStoreAdapter } from './json-agent-settings-store.adapter.js';


const SETTINGS: AgentSettings = {
  agentId: 'claude',
  agentName: 'Claude Code',
  modelId: 'm1',
  modelName: 'Model 1',
  effortId: 'high',
  effortName: 'High',
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
    const copilot = { ...SETTINGS, agentId: 'copilot', agentName: 'Copilot' };

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

  it('should normalize missing optional fields', async () => {
    writeFileSync(
      join(rootDir, 'agent-settings.json'),
      JSON.stringify({ conv: { agentId: 'claude' } }),
    );

    await expect(new JsonAgentSettingsStoreAdapter(rootDir).load('conv')).resolves.toEqual({
      agentId: 'claude',
      agentName: 'claude',
      modelId: null,
      modelName: null,
      effortId: null,
      effortName: null,
      updatedAt: '',
    });
  });

  it.each([
    ['invalid JSON', '{not json'],
    ['null', 'null'],
    ['legacy global settings', JSON.stringify({ agentId: 'claude', modelId: 'm1' })],
    ['missing agent', JSON.stringify({ conv: { modelId: 'm1' } })],
    ['non-string agent', JSON.stringify({ conv: { agentId: 42 } })],
    ['null entry', JSON.stringify({ conv: null })],
  ])('should return null for %s', async (_label, content) => {
    writeFileSync(join(rootDir, 'agent-settings.json'), content);

    await expect(new JsonAgentSettingsStoreAdapter(rootDir).load('conv')).resolves.toBeNull();
  });
});
