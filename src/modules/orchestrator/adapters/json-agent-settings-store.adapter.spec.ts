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
    await expect(new JsonAgentSettingsStoreAdapter(rootDir).load()).resolves.toBeNull();
  });

  it('should persist settings across instances', async () => {
    const dataDir = join(rootDir, 'nested');
    const store = new JsonAgentSettingsStoreAdapter(dataDir);

    await store.save(SETTINGS);

    await expect(store.load()).resolves.toEqual(SETTINGS);
    await expect(new JsonAgentSettingsStoreAdapter(dataDir).load()).resolves.toEqual(SETTINGS);
  });

  it('should normalize missing optional fields', async () => {
    writeFileSync(
      join(rootDir, 'agent-settings.json'),
      JSON.stringify({ agentId: 'claude' }),
    );

    await expect(new JsonAgentSettingsStoreAdapter(rootDir).load()).resolves.toEqual({
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
    ['missing agent', JSON.stringify({ modelId: 'm1', modelName: 'Model 1' })],
    ['non-string agent', JSON.stringify({ agentId: 42 })],
  ])('should return null for %s', async (_label, content) => {
    writeFileSync(join(rootDir, 'agent-settings.json'), content);

    await expect(new JsonAgentSettingsStoreAdapter(rootDir).load()).resolves.toBeNull();
  });
});
