import type {
  AgentProviderInfo,
  IAgentPortFactory,
} from '../../agent/ports/agent-port-factory.port.js';
import type { IAgentPort } from '../../agent/ports/agent.port.js';

import { StubAgentPort } from './stub-agent.port.js';


export class StubAgentPortFactory implements IAgentPortFactory {
  defaultAgentId = 'stub';
  agents: AgentProviderInfo[] = [{ agentId: 'stub', displayName: 'Stub Agent' }];
  readonly createdAgentIds: string[] = [];

  constructor(private readonly build: (agentId: string) => IAgentPort = StubAgentPortFactory.buildStub) {}

  listAgents(): readonly AgentProviderInfo[] {
    return this.agents;
  }

  create(agentId: string): IAgentPort {
    this.createdAgentIds.push(agentId);
    return this.build(agentId);
  }

  private static buildStub(this: void, agentId: string): IAgentPort {
    const port = new StubAgentPort();
    port.agentName = agentId;
    return port;
  }
}
