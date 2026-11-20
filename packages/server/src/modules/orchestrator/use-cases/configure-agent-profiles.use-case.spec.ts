import { beforeEach, describe, expect, it } from '@rstest/core';

import { AgentRegistryService } from '../../agent-definitions/services/agent-registry.service.js';
import { SqliteTransactionService } from '../../database/services/sqlite-transaction.service.js';
import { createInMemoryDataSource } from '../../database/testing/in-memory-data-source.js';
import { SqliteAgentSettingsStoreAdapter } from '../adapters/sqlite-agent-settings-store.adapter.js';
import { AgentCapabilitiesService } from '../services/agent-capabilities.service.js';
import { AgentProfileResolverService } from '../services/agent-profile-resolver.service.js';
import { AgentProfilesService } from '../services/agent-profiles.service.js';
import { InMemorySquadStoreFake } from '../testing/in-memory-squad-store.fake.js';
import { StubAgentPortFactory } from '../testing/stub-agent-port-factory.js';
import { StubAgentSettingsStore } from '../testing/stub-agent-settings-store.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { ConfigureAgentProfilesUseCase } from './configure-agent-profiles.use-case.js';


describe('ConfigureAgentProfilesUseCase', () => {
  let store: StubAgentSettingsStore;
  let factory: StubAgentPortFactory;
  let useCase: ConfigureAgentProfilesUseCase;

  beforeEach(() => {
    factory = new StubAgentPortFactory(() => {
      const port = new StubAgentPort();
      port.modelsToReturn = {
        availableModels: [{ modelId: 'fast', name: 'fast', displayName: 'Fast Model' }],
        currentModelId: 'fast',
      };
      port.effortsByModel = { fast: { availableEfforts: [{ effortId: 'high', name: 'High' }], currentEffortId: 'high' } };
      return port;
    });
    factory.agents = [{ agentId: 'stub', displayName: 'Stub Agent' }];
    store = new StubAgentSettingsStore();
    const capabilities = new AgentCapabilitiesService(factory);
    useCase = new ConfigureAgentProfilesUseCase(
      capabilities,
      new AgentProfileResolverService(capabilities),
      new AgentProfilesService(capabilities, store, new AgentRegistryService(), new InMemorySquadStoreFake()),
    );
  });

  it('should save the profile with names taken from the lists, for every role when none are given', async () => {
    await expect(useCase.execute({ conversationId: 'conv', agentId: 'stub', modelId: 'fast', effortId: 'high' }))
      .resolves.toEqual({ ok: true });

    const saved = await store.load('conv');
    expect(Object.keys(saved?.profiles ?? {})).toEqual(new AgentRegistryService().listRoles());
    expect(saved?.profiles.CEO).toEqual({
      agentId: 'stub',
      agentName: 'Stub Agent',
      modelId: 'fast',
      modelName: 'Fast Model',
      effortId: 'high',
      effortName: 'High',
    });
  });

  it('should save a profile with only an agent, for the given roles', async () => {
    await useCase.execute({ conversationId: 'conv', roles: ['DEVELOPER'], agentId: 'stub' });

    const saved = await store.load('conv');
    expect(Object.keys(saved?.profiles ?? {})).toEqual(['DEVELOPER']);
    expect(saved?.profiles.DEVELOPER).toMatchObject({ agentId: 'stub', modelId: null, modelName: null, effortId: null });
  });

  it.each([
    ['an unknown agent', { agentId: 'ghost' }, 'Unknown agent'],
    ['an unknown role', { agentId: 'stub', roles: ['PIRATE'] }, 'Unknown role'],
    ['an unknown model', { agentId: 'stub', modelId: 'ghost' }, 'Unknown model'],
    ['an effort without a model', { agentId: 'stub', effortId: 'high' }, 'An effort needs a model'],
    ['an unknown effort', { agentId: 'stub', modelId: 'fast', effortId: 'ghost' }, 'Unknown effort'],
  ])('should refuse %s without saving anything', async (_label, input, error) => {
    await expect(useCase.execute({ conversationId: 'conv', ...input })).resolves.toEqual({ ok: false, error });

    expect(store.saved).toEqual([]);
  });

  it('should keep every role of profile changes sent together, while each waits on its agent', async () => {
    const dataSource = await createInMemoryDataSource();
    try {
      const sqliteStore = new SqliteAgentSettingsStoreAdapter(dataSource, new SqliteTransactionService(dataSource));
      const capabilities = new AgentCapabilitiesService(factory);
      const stored = new ConfigureAgentProfilesUseCase(
        capabilities,
        new AgentProfileResolverService(capabilities),
        new AgentProfilesService(capabilities, sqliteStore, new AgentRegistryService(), new InMemorySquadStoreFake()),
      );
      const roles = ['CEO', 'DEVELOPER', 'QA', 'TECH_LEAD'];

      await Promise.all(roles.map((role, index) => stored.execute({
        conversationId: 'conv',
        roles: [role],
        agentId: 'stub',
        ...(index % 2 === 0 && { modelId: 'fast', effortId: 'high' }),
      })));

      const settings = await sqliteStore.load('conv');
      expect(Object.keys(settings!.profiles).sort()).toEqual([...roles].sort());
      expect(settings!.profiles.CEO).toMatchObject({ modelId: 'fast', effortId: 'high' });
      expect(settings!.profiles.DEVELOPER).toMatchObject({ modelId: null });
    } finally {
      await dataSource.destroy();
    }
  });
});
