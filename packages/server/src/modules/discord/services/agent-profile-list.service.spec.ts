import { beforeEach, describe, expect, it } from 'vitest';

import { StubAgentConfigurationPort } from '../../orchestrator/testing/stub-agent-configuration.port.js';
import { buildStubProfile, buildStubSettings } from '../../orchestrator/testing/stub-agent-settings-store.js';
import { InMemoryAgentConfigSelectionStoreAdapter } from '../adapters/in-memory-agent-config-selection-store.adapter.js';

import { AgentProfileListService } from './agent-profile-list.service.js';


describe('AgentProfileListService', () => {
  let configuration: StubAgentConfigurationPort;
  let selectionStore: InMemoryAgentConfigSelectionStoreAdapter;
  let service: AgentProfileListService;

  beforeEach(() => {
    configuration = new StubAgentConfigurationPort();
    configuration.defaultAgent = { id: 'stub', name: 'Stub Agent' };
    selectionStore = new InMemoryAgentConfigSelectionStoreAdapter();
    service = new AgentProfileListService(configuration, selectionStore);
  });

  it('should describe each role with the agent, model and effort of its profile', async () => {
    await configuration.store.save('conv', buildStubSettings({
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
    await configuration.store.save('conv', settings);
    configuration.unavailableAgentIds.add('other');

    const selection = await service.open('conv');

    expect(selection.options[0]!.description).toBe('Other Agent (not installed) - Opus - default');
    expect(await configuration.store.load('conv')).toBe(settings);
  });

  it('should not mark a profile whose agent is installed', async () => {
    await configuration.store.save('conv', buildStubSettings({
      CEO: buildStubProfile('stub', { agentName: 'Stub Agent' }),
    }));

    const selection = await service.open('conv');

    expect(selection.options[0]!.description).toBe('Stub Agent - default - default');
  });
});
