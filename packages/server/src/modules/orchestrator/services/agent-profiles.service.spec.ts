import { beforeEach, describe, expect, it, rs } from '@rstest/core';

import { AgentRegistryService } from '../../agent-definitions/services/agent-registry.service.js';
import { SqliteTransactionService } from '../../database/services/sqlite-transaction.service.js';
import { createInMemoryDataSource } from '../../database/testing/in-memory-data-source.js';
import { SqliteAgentSettingsStoreAdapter } from '../adapters/sqlite-agent-settings-store.adapter.js';
import type { Squad } from '../models/squad.model.js';
import { InMemorySquadStoreFake } from '../testing/in-memory-squad-store.fake.js';
import { StubAgentPortFactory } from '../testing/stub-agent-port-factory.js';
import { buildStubProfile, buildStubSettings, StubAgentSettingsStore } from '../testing/stub-agent-settings-store.js';

import { AgentCapabilitiesService } from './agent-capabilities.service.js';
import { AgentProfilesService } from './agent-profiles.service.js';


describe('AgentProfilesService', () => {
  let factory: StubAgentPortFactory;
  let store: StubAgentSettingsStore;
  let registry: AgentRegistryService;
  let squads: InMemorySquadStoreFake;
  let service: AgentProfilesService;

  const squad = (overrides: Partial<Squad> = {}): Squad => squads.seed({
    id: 's1',
    name: 'Backend team',
    isDefault: false,
    profiles: { CEO: buildStubProfile('squad-ceo'), QA: buildStubProfile('squad-qa', { modelId: 'm', effortId: 'e' }) },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  });

  beforeEach(() => {
    factory = new StubAgentPortFactory();
    store = new StubAgentSettingsStore();
    registry = new AgentRegistryService();
    squads = new InMemorySquadStoreFake();
    service = new AgentProfilesService(new AgentCapabilitiesService(factory), store, registry, squads);
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

    it('should keep the settings another change stored after the first check', async () => {
      const load = store.load.bind(store);
      store.load = async () => {
        store.load = load;
        return null;
      };
      store.byConversation.set('conv', buildStubSettings({ CEO: buildStubProfile('own') }));

      await expect(service.ensure('conv')).resolves.toBe('configured');
      expect(store.saved).toEqual([]);
    });

    it('should report missing settings when nothing was ever saved', async () => {
      await expect(service.ensure('conv')).resolves.toBe('missing');
    });

    it('should give a conversation without settings the default squad over the most recent settings', async () => {
      store.byConversation.set('other', buildStubSettings({ CEO: buildStubProfile('recent'), DEVELOPER: buildStubProfile('recent') }));
      squad({ isDefault: true });

      await expect(service.ensure('conv')).resolves.toBe('squad');

      const settings = await store.load('conv');
      expect(settings?.appliedSquad).toEqual({ id: 's1', name: 'Backend team' });
      expect(settings?.profiles.CEO?.agentId).toBe('squad-ceo');
      expect(settings?.profiles.DEVELOPER?.agentId).toBe('recent');
    });

    it('should give the default squad alone to the first conversation', async () => {
      squad({ isDefault: true });

      await expect(service.ensure('conv')).resolves.toBe('squad');
      expect(Object.keys((await store.load('conv'))!.profiles)).toEqual(['CEO', 'QA']);
    });
  });

  describe('current with a default squad', () => {
    it('should show what a conversation without settings would start with, without saving it', async () => {
      squad({ isDefault: true });

      await expect(service.current('conv')).resolves.toMatchObject({ appliedSquad: { id: 's1' }, profiles: { CEO: { agentId: 'squad-ceo' } } });
      expect(store.saved).toEqual([]);
    });

    it('should leave out a squad that is not the default', async () => {
      squad();

      await expect(service.current('conv')).resolves.toBeNull();
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

  it('should list the roles a squad sets, in the order of the team', () => {
    factory.unavailableAgentIds.add('squad-qa');

    expect(service.listSquadProfiles(squad({ profiles: { QA: buildStubProfile('squad-qa'), CEO: buildStubProfile('stub') } }))).toEqual([
      { role: 'CEO', roleName: registry.getDisplayName('CEO'), profile: buildStubProfile('stub'), agentAvailable: true },
      { role: 'QA', roleName: registry.getDisplayName('QA'), profile: buildStubProfile('squad-qa'), agentAvailable: false },
    ]);
  });

  describe('applySquad', () => {
    it('should copy the squad over the roles of the conversation and leave the others as they are', async () => {
      store.byConversation.set('conv', buildStubSettings({ CEO: buildStubProfile('own'), DEVELOPER: buildStubProfile('own') }));

      const settings = await service.applySquad('conv', squad());

      expect(settings.profiles.CEO?.agentId).toBe('squad-ceo');
      expect(settings.profiles.QA?.agentId).toBe('squad-qa');
      expect(settings.profiles.DEVELOPER?.agentId).toBe('own');
      expect(settings.appliedSquad).toEqual({ id: 's1', name: 'Backend team' });
      expect(store.saved).toHaveLength(1);
    });

    it('should start a conversation without settings from what it would run with', async () => {
      store.byConversation.set('other', buildStubSettings({ DEVELOPER: buildStubProfile('recent') }));
      squad({ id: 'default', name: 'Default', isDefault: true, profiles: { GIT_OPS: buildStubProfile('default') } });

      const settings = await service.applySquad('conv', squad());

      expect(Object.fromEntries(Object.entries(settings.profiles).map(([role, profile]) => [role, profile.agentId]))).toEqual({
        DEVELOPER: 'recent',
        GIT_OPS: 'default',
        CEO: 'squad-ceo',
        QA: 'squad-qa',
      });
      expect(settings.appliedSquad).toEqual({ id: 's1', name: 'Backend team' });
    });

    it('should apply a squad to the first conversation', async () => {
      const settings = await service.applySquad('conv', squad());

      expect(Object.keys(settings.profiles)).toEqual(['CEO', 'QA']);
    });
  });

  describe('squadState', () => {
    it('should report no squad for a conversation that never applied one', async () => {
      await expect(service.squadState('conv')).resolves.toEqual({ customized: false });
      store.byConversation.set('conv', buildStubSettings({ CEO: buildStubProfile('own') }));
      await expect(service.squadState('conv')).resolves.toEqual({ customized: false });
    });

    it('should report the squad as it is named now, untouched until a role leaves it', async () => {
      await service.applySquad('conv', squad());
      squad({ name: 'Renamed' });

      await expect(service.squadState('conv')).resolves.toEqual({ appliedSquad: { id: 's1', name: 'Renamed' }, customized: false });

      await service.save('conv', ['DEVELOPER'], buildStubProfile('other'));
      await expect(service.squadState('conv')).resolves.toMatchObject({ customized: false });

      await service.save('conv', ['QA'], buildStubProfile('squad-qa', { modelId: 'm', effortId: 'other' }));
      await expect(service.squadState('conv')).resolves.toMatchObject({ customized: true });
    });

    it('should report a squad edited after it was applied as customized', async () => {
      await service.applySquad('conv', squad());
      squad({ profiles: { CEO: buildStubProfile('squad-ceo', { modelId: 'new' }) } });

      await expect(service.squadState('conv')).resolves.toMatchObject({ customized: true });
    });

    it('should report a squad that gained a role after it was applied as customized', async () => {
      await service.applySquad('conv', squad());
      squad({ profiles: { ...squad().profiles, GIT_OPS: buildStubProfile('git') } });

      await expect(service.squadState('conv')).resolves.toMatchObject({ customized: true });
    });

    it('should keep the name of a deleted squad and report it as customized', async () => {
      await service.applySquad('conv', squad());
      await squads.delete('s1');

      await expect(service.squadState('conv')).resolves.toEqual({ appliedSquad: { id: 's1', name: 'Backend team' }, customized: true });
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
      rs.useFakeTimers({ toFake: ['Date'] });
      rs.setSystemTime(new Date('2026-03-04T05:06:07.000Z'));

      try {
        const settings = await service.save('conv', undefined, profile);

        expect(settings.updatedAt).toBe('2026-03-04T05:06:07.000Z');
      } finally {
        rs.useRealTimers();
      }
    });

    it('should start a conversation without settings from the default squad, keeping it applied', async () => {
      squad({ isDefault: true });

      const settings = await service.save('conv', ['DEVELOPER'], profile);

      expect(settings.profiles.CEO?.agentId).toBe('squad-ceo');
      expect(settings.profiles.DEVELOPER?.agentId).toBe('stub');
      expect(settings.appliedSquad).toEqual({ id: 's1', name: 'Backend team' });
    });

    it('should change only the given roles and keep the others from the current settings', async () => {
      store.byConversation.set('conv', buildStubSettings({ CEO: buildStubProfile('old'), DEVELOPER: buildStubProfile('old') }));

      const settings = await service.save('conv', ['DEVELOPER'], profile);

      expect(settings.profiles.CEO?.agentId).toBe('old');
      expect(settings.profiles.DEVELOPER?.agentId).toBe('stub');
    });
  });

  it('should keep four concurrent profile changes to different roles of one conversation in the database', async () => {
    const dataSource = await createInMemoryDataSource();
    try {
      const sqliteStore = new SqliteAgentSettingsStoreAdapter(new SqliteTransactionService(dataSource));
      const stored = new AgentProfilesService(new AgentCapabilitiesService(factory), sqliteStore, registry, squads);
      const roles = ['CEO', 'DEVELOPER', 'QA', 'TECH_LEAD'];

      await Promise.all(roles.map(role => stored.save('conv', [role], buildStubProfile(`agent-${role}`))));

      const settings = await sqliteStore.load('conv');
      expect(roles.map(role => settings?.profiles[role]?.agentId)).toEqual(roles.map(role => `agent-${role}`));
    } finally {
      await dataSource.destroy();
    }
  });
});
