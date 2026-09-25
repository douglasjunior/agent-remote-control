export interface IAgentRegistryPort {
  getSystemPrompt(agentRoleOrId?: string): string | undefined;
  getDefaultModel(agentRoleOrId?: string): string | undefined;
}

export const IAgentRegistryPort = Symbol('IAgentRegistryPort');
