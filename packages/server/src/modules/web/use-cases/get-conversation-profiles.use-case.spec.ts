import { buildStubProfile } from '../../orchestrator/testing/stub-agent-settings-store.js';
import { createWebHarness } from '../testing/web-harness.js';

import { GetConversationProfilesUseCase } from './get-conversation-profiles.use-case.js';


const full = buildStubProfile('codex', {
  agentName: 'Codex',
  modelId: 'gpt',
  modelName: 'GPT',
  effortId: 'high',
  effortName: 'High',
});

describe('GetConversationProfilesUseCase', () => {
  it('maps the role profiles to the protocol shape', async () => {
    const { configuration } = createWebHarness();
    configuration.unavailableAgentIds.add('other');
    configuration.store.byConversation.set('web-1', {
      profiles: {
        CEO: full,
        DEVELOPER: buildStubProfile('other', { agentName: 'Other' }),
      },
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const result = await new GetConversationProfilesUseCase(configuration).execute('web-1');

    expect(result.configured).toBe(true);
    expect(result.profiles.find(profile => profile.role === 'CEO')).toEqual({
      role: 'CEO',
      roleName: expect.any(String),
      agent: { id: 'codex', name: 'Codex', available: true },
      model: { id: 'gpt', name: 'GPT' },
      effort: { id: 'high', name: 'High' },
    });
    expect(result.profiles.find(profile => profile.role === 'DEVELOPER')).toMatchObject({
      agent: { id: 'other', name: 'Other', available: false },
    });
    expect(result.profiles.find(profile => profile.role === 'DEVELOPER')).not.toHaveProperty('model');
  });

  it('falls back to the ids when a stored profile has no names, and lists roles without a profile', async () => {
    const { configuration } = createWebHarness();
    configuration.store.byConversation.set('web-1', {
      profiles: { CEO: { ...full, modelName: null, effortName: null } },
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const profiles = (await new GetConversationProfilesUseCase(configuration).execute('web-1')).profiles;

    expect(profiles[0]).toMatchObject({ model: { id: 'gpt', name: 'gpt' }, effort: { id: 'high', name: 'high' } });
  });

  it('is not configured while there are no settings to run with, and reading does not change that', async () => {
    const { configuration } = createWebHarness();

    const result = await new GetConversationProfilesUseCase(configuration).execute('web-1');

    expect(result.configured).toBe(false);
    expect(result.profiles.every(profile => !('agent' in profile))).toBe(true);
    expect(configuration.store.saved).toEqual([]);
  });

  it('is configured through the most recent settings without copying them', async () => {
    const { configuration } = createWebHarness();
    configuration.store.byConversation.set('other', { profiles: { CEO: full }, updatedAt: '2026-01-01T00:00:00Z' });

    const result = await new GetConversationProfilesUseCase(configuration).execute('web-1');

    expect(result.configured).toBe(true);
    expect(await configuration.store.load('web-1')).toBeNull();
  });
});
