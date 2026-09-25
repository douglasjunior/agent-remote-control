import { Injectable } from '@nestjs/common';
import type { IAgentRegistryPort } from '../ports/agent-registry.port.js';

const ROLE_PROMPTS: Record<string, string> = {
  CEO: 'You are an executive agent focused on strategic leadership, scope, and project alignment.',
  DEVELOPER:
    'You are a senior software engineer focused on robust implementation, clean code, and automated tests.',
};

@Injectable()
export class DefaultAgentRegistryAdapter implements IAgentRegistryPort {
  private readonly rolePrompts: Record<string, string>;
  private readonly roleModels: Record<string, string>;

  constructor() {
    this.rolePrompts = { ...ROLE_PROMPTS };
    this.roleModels = {};
  }

  registerRole(role: string, prompt?: string, model?: string): void {
    const normalized = role.toUpperCase();
    if (prompt) {
      this.rolePrompts[normalized] = prompt;
    }
    if (model) {
      this.roleModels[normalized] = model;
    }
  }

  getSystemPrompt(agentRoleOrId?: string): string | undefined {
    if (!agentRoleOrId) {
      return undefined;
    }
    const normalized = agentRoleOrId.toUpperCase();
    return (
      this.rolePrompts[normalized] ??
      `You are an AI assistant acting in the role of ${agentRoleOrId}.`
    );
  }

  getDefaultModel(agentRoleOrId?: string): string | undefined {
    if (!agentRoleOrId) {
      return undefined;
    }
    return this.roleModels[agentRoleOrId.toUpperCase()];
  }
}
