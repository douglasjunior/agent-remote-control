export interface IAgentRegistryPort {
  getSystemPrompt(agentRole: string): string;
  getDefaultModel(agentRole: string): string | undefined;
  getDisplayName(agentRole: string): string;
  hasRole(agentRole: string): boolean;
}

export const IAgentRegistryPort = Symbol('IAgentRegistryPort');
