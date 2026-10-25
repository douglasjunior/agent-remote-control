import { Injectable } from '@nestjs/common';

import type { WorkspaceFile } from '../../orchestrator/models/workspace-file.model.js';
import type {
  DelegationContract,
  IAgentRegistryPort,
} from '../../orchestrator/ports/agent-registry.port.js';
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
    return definition.buildSystemPrompt(this.getTeam(definition));
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

  getDefaultSessionMode(agentRole: string): 'resume' | 'new' {
    return this.getDefinition(agentRole)?.defaultSessionMode ?? 'resume';
  }

  getDelegationContract(agentRole: string): DelegationContract {
    return this.getDefinition(agentRole)?.delegation ?? {};
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

  getWorkspaceFiles(workspaceDir: string): readonly WorkspaceFile[] {
    return this.getAllDefinitions().flatMap(definition =>
      definition.buildWorkspaceFiles?.(this.getTeam(definition), workspaceDir) ?? []);
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

  private getTeam(definition: AgentDefinition): AgentDefinition[] {
    return this.getAllDefinitions().filter(other => other !== definition);
  }
}
