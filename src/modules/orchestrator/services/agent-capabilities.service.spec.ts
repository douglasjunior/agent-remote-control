import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentSettings } from '../models/agent-settings.model.js';
import { StubAgentPortFactory } from '../testing/stub-agent-port-factory.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { AgentCapabilitiesService } from './agent-capabilities.service.js';


describe('AgentCapabilitiesService', () => {
  let ports: StubAgentPort[];
  let factory: StubAgentPortFactory;
  let service: AgentCapabilitiesService;

  beforeEach(() => {
    ports = [];
    factory = new StubAgentPortFactory((agentId) => {
      const port = new StubAgentPort();
      port.agentName = agentId;
      port.modelsToReturn = {
        availableModels: [
          { modelId: 'm1', name: 'm1', displayName: 'Model 1', description: 'First model' },
          { modelId: 'm2', name: 'm2', displayName: 'Model 2' },
        ],
        currentModelId: 'm1',
      };
      port.effortsByModel = {
        m1: {
          availableEfforts: [{ effortId: 'low', name: 'Low', description: 'Fast' }],
          currentEffortId: 'low',
        },
      };
      ports.push(port);
      return port;
    });
    factory.agents = [
      { agentId: 'stub', displayName: 'Stub Agent' },
      { agentId: 'other', displayName: 'Other Agent' },
    ];
    service = new AgentCapabilitiesService(factory);
  });

  describe('resolveAgent', () => {
    const settings: AgentSettings = {
      agentId: 'other',
      agentName: 'Other Agent',
      modelId: null,
      modelName: null,
      effortId: null,
      effortName: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('should return the agent persisted in the settings', () => {
      expect(service.resolveAgent(settings)).toEqual({ id: 'other', name: 'Other Agent' });
    });

    it('should return the factory default agent with its display name when there are no settings', () => {
      expect(service.resolveAgent(null)).toEqual({ id: 'stub', name: 'Stub Agent' });
    });

    it('should fall back to the agent id as name when the default agent is not listed', () => {
      factory.agents = [{ agentId: 'other', displayName: 'Other Agent' }];

      expect(service.resolveAgent(null)).toEqual({ id: 'stub', name: 'stub' });
    });
  });

  describe('listAgentOptions', () => {
    it('should number the available agents starting at one', () => {
      expect(service.listAgentOptions()).toEqual([
        { index: 1, id: 'stub', label: 'Stub Agent' },
        { index: 2, id: 'other', label: 'Other Agent' },
      ]);
    });

    it('should return an empty list when no agent is available', () => {
      factory.agents = [];

      expect(service.listAgentOptions()).toEqual([]);
    });
  });

  describe('listModelOptions', () => {
    it('should list numbered models on a disposable port created for the agent', async () => {
      const options = await service.listModelOptions('other');

      expect(options).toEqual([
        { index: 1, id: 'm1', label: 'Model 1', description: 'First model' },
        { index: 2, id: 'm2', label: 'Model 2', description: undefined },
      ]);
      expect(factory.createdAgentIds).toEqual(['other']);
      expect(ports[0]!.connectCalls).toBe(1);
      expect(ports[0]!.connected).toBe(false);
    });

    it('should return an empty list when the agent exposes no models', async () => {
      factory = new StubAgentPortFactory();
      service = new AgentCapabilitiesService(factory);

      await expect(service.listModelOptions('stub')).resolves.toEqual([]);
    });

    it('should disconnect the probe even when the agent fails to connect', async () => {
      const failing = new StubAgentPort();
      failing.errorToThrowOnConnect = new Error('agent down');
      failing.connected = true;
      service = new AgentCapabilitiesService(new StubAgentPortFactory(() => failing));

      await expect(service.listModelOptions('stub')).rejects.toThrow('agent down');
      expect(failing.connected).toBe(false);
    });

    it('should ignore disconnect failures', async () => {
      const port = new StubAgentPort();
      port.disconnect = async () => {
        throw new Error('already gone');
      };
      service = new AgentCapabilitiesService(new StubAgentPortFactory(() => port));

      await expect(service.listModelOptions('stub')).resolves.toEqual([]);
    });
  });

  describe('listEffortOptions', () => {
    it('should list numbered efforts of a model on a new port for the agent', async () => {
      await service.listModelOptions('other');
      const options = await service.listEffortOptions('other', 'm1');

      expect(options).toEqual([{ index: 1, id: 'low', label: 'Low', description: 'Fast' }]);
      expect(factory.createdAgentIds).toEqual(['other', 'other']);
      expect(ports[1]!.connected).toBe(false);
    });

    it('should return an empty list when the model exposes no efforts', async () => {
      await expect(service.listEffortOptions('stub', 'm2')).resolves.toEqual([]);
    });
  });
});
