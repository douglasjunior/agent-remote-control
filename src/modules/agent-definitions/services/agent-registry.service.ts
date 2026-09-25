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

  getSystemPrompt(agentRole: string): string {
    const definition = this.getDefinition(agentRole);
    if (!definition) {
      return `You are an AI assistant acting in the role of ${agentRole}.`;
    }
    const team = this.getAllDefinitions().filter(other => other !== definition);
    return definition.buildSystemPrompt(team);
  }

  getDefaultModel(agentRole: string): string | undefined {
    return this.getDefinition(agentRole)?.defaultModel;
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
