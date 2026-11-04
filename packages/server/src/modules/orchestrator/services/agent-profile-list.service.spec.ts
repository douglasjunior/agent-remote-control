import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistryService } from '../../agent-definitions/services/agent-registry.service.js';
import { InMemoryAgentConfigSelectionStoreAdapter } from '../adapters/in-memory-agent-config-selection-store.adapter.js';
import { StubAgentPortFactory } from '../testing/stub-agent-port-factory.js';
import { buildStubProfile, buildStubSettings, StubAgentSettingsStore } from '../testing/stub-agent-settings-store.js';

import { AgentCapabilitiesService } from './agent-capabilities.service.js';
import { AgentProfileListService } from './agent-profile-list.service.js';


describe('AgentProfileListService', () => {
  let factory: StubAgentPortFactory;
  let settingsStore: StubAgentSettingsStore;
  let selectionStore: InMemoryAgentConfigSelectionStoreAdapter;
  let service: AgentProfileListService;

  beforeEach(() => {
    factory = new StubAgentPortFactory();
    factory.agents = [
      { agentId: 'stub', displayName: 'Stub Agent' },
      { agentId: 'other', displayName: 'Other Agent' },
    ];
    settingsStore = new StubAgentSettingsStore();
    selectionStore = new InMemoryAgentConfigSelectionStoreAdapter();
    service = new AgentProfileListService(
      new AgentCapabilitiesService(factory),
      selectionStore,
      settingsStore,
      new AgentRegistryService(),
    );
  });

  it('should describe each role with the agent, model and effort of its profile', async () => {
    await settingsStore.save('conv', buildStubSettings({
      CEO: buildStubProfile('other', {
        agentName: 'Other Agent',
        modelName: 'Opus',
        effortName: 'High',
      }),
    }));

    const selection = await service.open('conv');

    expect(selection.step).toBe('profile');
    expect(selection.options[0]).toMatchObject({ id: 'CEO', description: 'Other Agent - Opus - High' });
    expect(await selectionStore.find('conv')).toEqual(selection);
  });

  it('should describe the roles with the default agent when there are no settings', async () => {
    const selection = await service.open('conv');

    expect(selection.options.every(option => option.description === 'Stub Agent - default - default')).toBe(true);
  });

  it('should mark a profile whose agent is not installed without changing the saved settings', async () => {
    const settings = buildStubSettings({
      CEO: buildStubProfile('other', { agentName: 'Other Agent', modelName: 'Opus' }),
    });
    await settingsStore.save('conv', settings);
    factory.unavailableAgentIds.add('other');

    const selection = await service.open('conv');

    expect(selection.options[0]!.description).toBe('Other Agent (not installed) - Opus - default');
    expect(await settingsStore.load('conv')).toBe(settings);
  });

  it('should not mark a profile whose agent is installed', async () => {
    await settingsStore.save('conv', buildStubSettings({
      CEO: buildStubProfile('stub', { agentName: 'Stub Agent' }),
    }));

    const selection = await service.open('conv');

    expect(selection.options[0]!.description).toBe('Stub Agent - default - default');
  });
});
