export interface IAgentRegistryPort {
  getSystemPrompt(agentRole: string): string;
  getDefaultModel(agentRole: string): string | undefined;
  getDisplayName(agentRole: string): string;
}

export const IAgentRegistryPort = Symbol('IAgentRegistryPort');
