import { Inject, Injectable } from '@nestjs/common';

import {
  type AgentProviderInfo,
  IAgentPortFactory,
} from '../../agent/ports/agent-port-factory.port.js';
import type { IAgentPort } from '../../agent/ports/agent.port.js';
import type { AgentOption } from '../models/agent-option.model.js';
import type { AgentSettings } from '../models/agent-settings.model.js';
import { resolveProfile } from '../utils/agent-profile.util.js';


@Injectable()
export class AgentCapabilitiesService {
  constructor(
    @Inject(IAgentPortFactory)
    private readonly agentPortFactory: IAgentPortFactory,
  ) {}

  resolveAgent(settings: AgentSettings | null): AgentOption {
    const profile = settings ? resolveProfile(settings, 'CEO') : undefined;
    if (profile) {
      return { id: profile.agentId, name: profile.agentName };
    }
    const agentId = this.agentPortFactory.defaultAgentId;
    const agent = this.agentPortFactory.listAgents().find(provider => provider.agentId === agentId);
    return { id: agentId, name: agent?.displayName ?? agentId };
  }

  isAgentAvailable(agentId: string): boolean {
    return this.agentPortFactory.isAgentAvailable(agentId);
  }

  listAgentOptions(): readonly AgentOption[] {
    return this.agentPortFactory.listAvailableAgents().map((agent: AgentProviderInfo) => ({
      id: agent.agentId,
      name: agent.displayName,
    }));
  }

  listModelOptions(agentId: string): Promise<readonly AgentOption[]> {
    return this.withProbe(agentId, async (port) => {
      const models = port.getAvailableModels();
      return (models?.availableModels ?? []).map(model => ({
        id: model.modelId,
        name: model.displayName,
        description: model.description,
      }));
    });
  }

  listEffortOptions(agentId: string, modelId: string): Promise<readonly AgentOption[]> {
    return this.withProbe(agentId, async (port) => {
      const efforts = await port.getAvailableEffortsForModel(modelId);
      return (efforts?.availableEfforts ?? []).map(effort => ({
        id: effort.effortId,
        name: effort.name,
        description: effort.description,
      }));
    });
  }

  private async withProbe<T>(agentId: string, read: (port: IAgentPort) => Promise<T>): Promise<T> {
    const port = this.agentPortFactory.create(agentId);
    try {
      await port.connect();
      return await read(port);
    } finally {
      await port.disconnect().catch(() => undefined);
    }
  }
}
