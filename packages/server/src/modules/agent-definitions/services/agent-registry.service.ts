import { Injectable } from '@nestjs/common';

import type {
  ArtifactAccess,
  DelegationContract,
  IAgentRegistryPort,
} from '../../orchestrator/ports/agent-registry.port.js';
import { INITIAL_AGENT_DEFINITIONS } from '../constants/initial-agents.constant.js';
import type { AgentDefinition } from '../models/agent-definition.model.js';


const READ_TASKS_ONLY: ArtifactAccess = { scope: 'task', sections: [], fields: [] };


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
    return definition.buildSystemPrompt(this.getTeam(agentRole));
  }

  getDefaultModel(agentRole: string): string | undefined {
    return this.getDefinition(agentRole)?.defaultModel;
  }

  getDisplayName(agentRole: string): string {
    return this.getDefinition(agentRole)?.name ?? agentRole;
  }

  hasRole(agentRole: string): boolean {
    return this.getDefinition(agentRole) !== undefined;
  }

  listRoles(): string[] {
    return this.getAllDefinitions().map(definition => definition.role);
  }

  getDefaultSessionMode(agentRole: string): 'resume' | 'new' {
    return this.getDefinition(agentRole)?.defaultSessionMode ?? 'resume';
  }

  getDelegationContract(agentRole: string): DelegationContract {
    return this.getDefinition(agentRole)?.delegation ?? {};
  }

  getArtifactAccess(agentRole: string): ArtifactAccess {
    return this.getDefinition(agentRole)?.artifacts ?? READ_TASKS_ONLY;
  }

  getTurnReminder(agentRole: string): string {
    const definition = this.getDefinition(agentRole);
    if (!definition) {
      return `You are an AI assistant acting in the role of ${agentRole}. Always provide your final response inside the <final_response> block.`;
    }
    return definition.turnReminder ?? '';
  }

  isSystemPromptEveryTurn(agentRole: string): boolean {
    return this.getDefinition(agentRole)?.systemPromptEveryTurn === true;
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

  /** The definitions a role works with: every one but its own. */
  getTeam(agentRole: string): AgentDefinition[] {
    const definition = this.getDefinition(agentRole);
    return this.getAllDefinitions().filter(other => other !== definition);
  }
}
