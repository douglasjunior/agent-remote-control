import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistryService } from '../../agent-definitions/services/agent-registry.service.js';
import { AgentCapabilitiesService } from '../services/agent-capabilities.service.js';
import { AgentProfilesService } from '../services/agent-profiles.service.js';
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
    useCase = new ConfigureAgentProfilesUseCase(capabilities, new AgentProfilesService(capabilities, store, new AgentRegistryService()));
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
});
