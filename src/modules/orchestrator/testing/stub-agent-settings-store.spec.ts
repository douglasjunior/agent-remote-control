import { describe, expect, it } from 'vitest';

import type { AgentSettings } from '../models/agent-settings.model.js';

import { buildStubProfile, buildStubSettings, StubAgentSettingsStore } from './stub-agent-settings-store.js';


describe('StubAgentSettingsStore', () => {
  const buildSettings = (agentId: string, updatedAt = '2026-01-01T00:00:00Z'): AgentSettings =>
    buildStubSettings({ CEO: buildStubProfile(agentId, { modelId: 'pro' }) }, updatedAt);

  it('should build a profile with null model and effort by default', () => {
    expect(buildStubProfile('agy')).toEqual({
      agentId: 'agy',
      agentName: 'agy',
      modelId: null,
      modelName: null,
      effortId: null,
      effortName: null,
    });
  });

  it('should return null or default settings when conversation is not present', async () => {
    const store = new StubAgentSettingsStore();
    expect(await store.load('conv-1')).toBeNull();
    expect(await store.loadMostRecent()).toBeNull();

    const fallback = buildSettings('fallback');
    store.settings = fallback;
    expect(await store.load('conv-1')).toBe(fallback);
    expect(await store.loadMostRecent()).toBe(fallback);
  });

  it('should save and load settings by conversationId', async () => {
    const store = new StubAgentSettingsStore();
    const settings = buildSettings('agy');

    await store.save('conv-1', settings);

    expect(await store.load('conv-1')).toBe(settings);
    expect(store.saved).toEqual([settings]);
  });

  it('should return the most recent settings among multiple conversations', async () => {
    const store = new StubAgentSettingsStore();
    const older = buildSettings('older');
    const newer = buildSettings('newer', '2026-01-02T00:00:00Z');
    const intermediate = buildSettings('mid', '2026-01-01T12:00:00Z');

    await store.save('conv-1', older);
    await store.save('conv-2', newer);
    await store.save('conv-3', intermediate);

    expect(await store.loadMostRecent()).toEqual(newer);
  });
});
