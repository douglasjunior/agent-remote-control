import type { AgentOption } from '@agent-remote-control/protocol/agent-option';
import { Inject, Injectable } from '@nestjs/common';

import { IAgentConfigurationPort } from '../../orchestrator/ports/agent-configuration.port.js';


@Injectable()
export class ListAgentOptionsUseCase {
  constructor(@Inject(IAgentConfigurationPort) private readonly configuration: IAgentConfigurationPort) {}

  agents(): readonly AgentOption[] {
    return this.configuration.listAgents();
  }

  /** `null` when the agent is not one of the available agents. */
  async models(agentId: string): Promise<readonly AgentOption[] | null> {
    return this.isAvailable(agentId) ? this.configuration.listModels(agentId) : null;
  }

  /** `null` when the agent is not one of the available agents. */
  async efforts(agentId: string, modelId: string): Promise<readonly AgentOption[] | null> {
    return this.isAvailable(agentId) ? this.configuration.listEfforts(agentId, modelId) : null;
  }

  private isAvailable(agentId: string): boolean {
    return this.configuration.listAgents().some(agent => agent.id === agentId);
  }
}
