import type { IAgentPort } from './agent.port.js';


export type AgentProviderInfo = {
  readonly agentId: string;
  readonly displayName: string;
};

export interface IAgentPortFactory {
  readonly defaultAgentId: string;
  listAgents(): readonly AgentProviderInfo[];
  listAvailableAgents(): readonly AgentProviderInfo[];
  isAgentAvailable(agentId: string): boolean;
  create(agentId: string): IAgentPort;
}

export const IAgentPortFactory = Symbol('IAgentPortFactory');
