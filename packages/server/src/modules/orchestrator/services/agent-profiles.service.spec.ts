import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRegistryService } from '../../agent-definitions/services/agent-registry.service.js';
import { StubAgentPortFactory } from '../testing/stub-agent-port-factory.js';
import { buildStubProfile, buildStubSettings, StubAgentSettingsStore } from '../testing/stub-agent-settings-store.js';

import { AgentCapabilitiesService } from './agent-capabilities.service.js';
import { AgentProfilesService } from './agent-profiles.service.js';


describe('AgentProfilesService', () => {
  let factory: StubAgentPortFactory;
  let store: StubAgentSettingsStore;
  let registry: AgentRegistryService;
  let service: AgentProfilesService;

  beforeEach(() => {
    factory = new StubAgentPortFactory();
    store = new StubAgentSettingsStore();
    registry = new AgentRegistryService();
    service = new AgentProfilesService(new AgentCapabilitiesService(factory), store, registry);
  });

  describe('current', () => {
    it('should prefer the conversation settings over the most recent ones', async () => {
      const own = buildStubSettings({ CEO: buildStubProfile('own') });
      store.byConversation.set('conv', own);
      store.byConversation.set('other', buildStubSettings({ CEO: buildStubProfile('other') }, '2030-01-01T00:00:00Z'));

      await expect(service.current('conv')).resolves.toBe(own);
    });

    it('should fall back to the most recent settings, and to nothing', async () => {
      await expect(service.current('conv')).resolves.toBeNull();

      const recent = buildStubSettings({ CEO: buildStubProfile('recent') });
      store.byConversation.set('other', recent);

      await expect(service.current('conv')).resolves.toBe(recent);
    });
  });

  describe('ensure', () => {
    it('should keep the settings a conversation already has', async () => {
      store.byConversation.set('conv', buildStubSettings({ CEO: buildStubProfile('own') }));

      await expect(service.ensure('conv')).resolves.toBe('configured');
      expect(store.saved).toEqual([]);
    });

    it('should copy the most recent settings into a conversation without any', async () => {
      store.byConversation.set('other', buildStubSettings({ CEO: buildStubProfile('recent') }));

      await expect(service.ensure('conv')).resolves.toBe('inherited');

      const saved = await store.load('conv');
      expect(saved?.profiles.CEO?.agentId).toBe('recent');
      expect(saved?.updatedAt).not.toBe('2026-01-01T00:00:00Z');
    });

    it('should report missing settings when nothing was ever saved', async () => {
      await expect(service.ensure('conv')).resolves.toBe('missing');
    });
  });

  describe('list', () => {
    it('should list every role with its profile and whether its agent is installed', async () => {
      store.byConversation.set('conv', buildStubSettings({
        CEO: buildStubProfile('other', { agentName: 'Other Agent' }),
      }));
      factory.unavailableAgentIds.add('other');

      const profiles = await service.list('conv');

      expect(profiles.map(entry => entry.role)).toEqual(registry.listRoles());
      expect(profiles[0]).toMatchObject({
        role: 'CEO',
        roleName: registry.getDisplayName('CEO'),
        profile: { agentId: 'other' },
        agentAvailable: false,
      });
    });

    it('should list roles without a profile when there are no settings', async () => {
      const profiles = await service.list('conv');

      expect(profiles.every(entry => !('profile' in entry) && !('agentAvailable' in entry))).toBe(true);
    });

    it('should mark an installed agent as available', async () => {
      store.byConversation.set('conv', buildStubSettings({ CEO: buildStubProfile('stub') }));

      expect((await service.list('conv'))[0]).toMatchObject({ agentAvailable: true });
    });
  });

  it('should name the roles', () => {
    expect(service.listRoles()[0]).toEqual({ role: 'CEO', roleName: registry.getDisplayName('CEO') });
  });

  describe('save', () => {
    const profile = buildStubProfile('stub', { agentName: 'Stub Agent' });

    it('should save the profile for every role when none are given', async () => {
      const settings = await service.save('conv', undefined, profile);

      expect(Object.keys(settings.profiles)).toEqual(registry.listRoles());
      await expect(store.load('conv')).resolves.toEqual(settings);
    });

    it('should stamp the settings with the current time', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-03-04T05:06:07.000Z'));

      try {
        const settings = await service.save('conv', undefined, profile);

        expect(settings.updatedAt).toBe('2026-03-04T05:06:07.000Z');
      } finally {
        vi.useRealTimers();
      }
    });

    it('should change only the given roles and keep the others from the current settings', async () => {
      store.byConversation.set('conv', buildStubSettings({ CEO: buildStubProfile('old'), DEVELOPER: buildStubProfile('old') }));

      const settings = await service.save('conv', ['DEVELOPER'], profile);

      expect(settings.profiles.CEO?.agentId).toBe('old');
      expect(settings.profiles.DEVELOPER?.agentId).toBe('stub');
    });
  });
});
