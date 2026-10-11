import { describe, expect, it } from 'vitest';

import type { AgentQuota } from '../../agent/ports/agent.port.js';
import type { AgentSettings } from '../models/agent-settings.model.js';
import { AgentCapabilitiesService } from '../services/agent-capabilities.service.js';
import { StubAgentPortFactory } from '../testing/stub-agent-port-factory.js';
import { StubAgentSettingsStore } from '../testing/stub-agent-settings-store.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { GetAgentQuotaUseCase } from './get-agent-quota.use-case.js';


const quota: AgentQuota = { groups: [] };

describe('GetAgentQuotaUseCase', () => {
  it('should read the quota of the default agent when no settings are saved', async () => {
    const factory = new StubAgentPortFactory(() => {
      const port = new StubAgentPort();
      port.quotaToReturn = quota;
      return port;
    });
    const useCase = new GetAgentQuotaUseCase(
      new AgentCapabilitiesService(factory),
      factory,
      new StubAgentSettingsStore(),
    );

    expect(await useCase.execute('conv')).toEqual({
      agent: { id: 'stub', name: 'Stub Agent' },
      quota,
    });
  });

  it('should read the quota of the agent saved in settings', async () => {
    const factory = new StubAgentPortFactory();
    const store = new StubAgentSettingsStore();
    const settings: AgentSettings = {
      agentId: 'agy',
      agentName: 'Antigravity',
      modelId: null,
      modelName: null,
      effortId: null,
      effortName: null,
      updatedAt: '2026-01-01T00:00:00Z',
    };
    await store.save('conv', settings);
    const useCase = new GetAgentQuotaUseCase(
      new AgentCapabilitiesService(factory),
      factory,
      store,
    );

    const report = await useCase.execute('conv');

    expect(factory.createdAgentIds).toEqual(['agy']);
    expect(report).toEqual({
      agent: { id: 'agy', name: 'Antigravity' },
      quota: undefined,
    });
  });

  it('should fall back to the most recent settings when current conversation has none', async () => {
    const factory = new StubAgentPortFactory();
    const store = new StubAgentSettingsStore();
    const settings: AgentSettings = {
      agentId: 'copilot',
      agentName: 'Copilot',
      modelId: null,
      modelName: null,
      effortId: null,
      effortName: null,
      updatedAt: '2026-01-01T00:00:00Z',
    };
    await store.save('prev-conv', settings);
    const useCase = new GetAgentQuotaUseCase(
      new AgentCapabilitiesService(factory),
      factory,
      store,
    );

    const report = await useCase.execute('new-conv');

    expect(factory.createdAgentIds).toEqual(['copilot']);
    expect(report.agent).toEqual({ id: 'copilot', name: 'Copilot' });
  });
});
