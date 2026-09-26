export interface IAgentRegistryPort {
  getSystemPrompt(agentRole: string): string;
  getDefaultModel(agentRole: string): string | undefined;
  getDisplayName(agentRole: string): string;
  hasRole(agentRole: string): boolean;
  getDefaultSessionMode(agentRole: string): 'resume' | 'new';
  getTurnReminder(agentRole: string): string;
}

export const IAgentRegistryPort = Symbol('IAgentRegistryPort');
