import { beforeEach, describe, expect, it } from 'vitest';

import type { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { AgentCapabilitiesService } from './agent-capabilities.service.js';


describe('AgentCapabilitiesService', () => {
  let ports: StubAgentPort[];
  let service: AgentCapabilitiesService;

  beforeEach(() => {
    ports = [];
    const factory: IAgentPortFactory = {
      create: () => {
        const port = new StubAgentPort();
        port.modelsToReturn = {
          availableModels: [{ modelId: 'm1', name: 'm1', displayName: 'Model 1' }],
          currentModelId: 'm1',
        };
        port.effortsByModel = {
          m1: { availableEfforts: [{ effortId: 'low', name: 'Low' }], currentEffortId: 'low' },
        };
        ports.push(port);
        return port;
      },
    };
    service = new AgentCapabilitiesService(factory);
  });

  it('should list models on a disposable connected port', async () => {
    const models = await service.listModels();

    expect(models?.availableModels).toHaveLength(1);
    expect(ports).toHaveLength(1);
    expect(ports[0]!.connectCalls).toBe(1);
    expect(ports[0]!.connected).toBe(false);
  });

  it('should list the efforts of a model on a new port', async () => {
    await service.listModels();
    const efforts = await service.listEfforts('m1');

    expect(efforts?.availableEfforts).toEqual([{ effortId: 'low', name: 'Low' }]);
    expect(ports).toHaveLength(2);
  });

  it('should disconnect the probe even when the agent fails to connect', async () => {
    const failing = new StubAgentPort();
    failing.errorToThrowOnConnect = new Error('agent down');
    failing.connected = true;
    const failingService = new AgentCapabilitiesService({ create: () => failing });

    await expect(failingService.listModels()).rejects.toThrow('agent down');
    expect(failing.connected).toBe(false);
  });

  it('should ignore disconnect failures', async () => {
    const port = new StubAgentPort();
    port.disconnect = async () => {
      throw new Error('already gone');
    };
    const probeService = new AgentCapabilitiesService({ create: () => port });

    await expect(probeService.listModels()).resolves.toBeNull();
  });
});
