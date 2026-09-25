import { Injectable } from '@nestjs/common';

import type { IAgentRegistryPort } from '../../orchestrator/ports/agent-registry.port.js';
import { INITIAL_AGENT_DEFINITIONS } from '../constants/initial-agents.constant.js';
import type { AgentDefinition } from '../models/agent-definition.model.js';


@Injectable()
export class AgentRegistryService implements IAgentRegistryPort {
  private readonly definitions = new Map<string, AgentDefinition>();

  constructor() {
    for (const definition of INITIAL_AGENT_DEFINITIONS) {
      this.registerDefinition(definition);
    }
  }

  getSystemPrompt(agentRoleOrId?: string): string | undefined {
    if (!agentRoleOrId) {
      return undefined;
    }
    const definition = this.definitions.get(agentRoleOrId.toUpperCase());
    if (definition) {
      return definition.systemPrompt;
    }
    return `You are an AI assistant acting in the role of ${agentRoleOrId}.`;
  }

  getDefaultModel(agentRoleOrId?: string): string | undefined {
    if (!agentRoleOrId) {
      return undefined;
    }
    const definition = this.definitions.get(agentRoleOrId.toUpperCase());
    return definition?.defaultModel;
  }

  getDefinition(roleOrId: string): AgentDefinition | undefined {
    return this.definitions.get(roleOrId.toUpperCase());
  }

  getAllDefinitions(): AgentDefinition[] {
    return Array.from(this.definitions.values());
  }

  registerDefinition(definition: AgentDefinition): void {
    this.definitions.set(definition.role.toUpperCase(), definition);
  }
}
