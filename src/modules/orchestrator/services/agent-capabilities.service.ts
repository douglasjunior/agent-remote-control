import { Inject, Injectable } from '@nestjs/common';

import {
  type AgentProviderInfo,
  IAgentPortFactory,
} from '../../agent/ports/agent-port-factory.port.js';
import type { IAgentPort } from '../../agent/ports/agent.port.js';
import type { SelectedValue, SelectionOption } from '../models/agent-config-selection.model.js';
import type { AgentSettings } from '../models/agent-settings.model.js';
import { resolveProfile } from '../utils/agent-profile.util.js';


@Injectable()
export class AgentCapabilitiesService {
  constructor(
    @Inject(IAgentPortFactory)
    private readonly agentPortFactory: IAgentPortFactory,
  ) {}

  resolveAgent(settings: AgentSettings | null): SelectedValue {
    const profile = settings ? resolveProfile(settings, 'CEO') : undefined;
    if (profile) {
      return { id: profile.agentId, name: profile.agentName };
    }
    const agentId = this.agentPortFactory.defaultAgentId;
    const agent = this.agentPortFactory.listAgents().find(provider => provider.agentId === agentId);
    return { id: agentId, name: agent?.displayName ?? agentId };
  }

  listAgentOptions(): readonly SelectionOption[] {
    return this.agentPortFactory.listAgents().map((agent: AgentProviderInfo, position) => ({
      index: position + 1,
      id: agent.agentId,
      label: agent.displayName,
    }));
  }

  listModelOptions(agentId: string): Promise<readonly SelectionOption[]> {
    return this.withProbe(agentId, async (port) => {
      const models = port.getAvailableModels();
      return (models?.availableModels ?? []).map((model, position) => ({
        index: position + 1,
        id: model.modelId,
        label: model.displayName,
        description: model.description,
      }));
    });
  }

  listEffortOptions(agentId: string, modelId: string): Promise<readonly SelectionOption[]> {
    return this.withProbe(agentId, async (port) => {
      const efforts = await port.getAvailableEffortsForModel(modelId);
      return (efforts?.availableEfforts ?? []).map((effort, position) => ({
        index: position + 1,
        id: effort.effortId,
        label: effort.name,
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
