import type { IAgentPort } from './agent.port.js';


export interface IAgentPortFactory {
  create(): IAgentPort;
}

export const IAgentPortFactory = Symbol('IAgentPortFactory');
