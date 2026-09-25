export interface IAgentRegistryPort {
  getSystemPrompt(agentRole: string): string;
  getDefaultModel(agentRole: string): string | undefined;
}

export const IAgentRegistryPort = Symbol('IAgentRegistryPort');
