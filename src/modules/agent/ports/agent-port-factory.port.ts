import type { IAgentPort } from './agent.port.js';


export type AgentProviderInfo = {
  readonly agentId: string;
  readonly displayName: string;
};

export interface IAgentPortFactory {
  readonly defaultAgentId: string;
  listAgents(): readonly AgentProviderInfo[];
  create(agentId: string): IAgentPort;
}

export const IAgentPortFactory = Symbol('IAgentPortFactory');
