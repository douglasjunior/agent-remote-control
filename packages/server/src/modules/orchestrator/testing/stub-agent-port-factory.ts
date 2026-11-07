import type {
  AgentProviderInfo,
  IAgentPortFactory,
} from '../../agent/ports/agent-port-factory.port.js';
import type { IAgentPort } from '../../agent/ports/agent.port.js';

import { StubAgentPort } from './stub-agent.port.js';


export class StubAgentPortFactory implements IAgentPortFactory {
  defaultAgentIdReads = 0;
  private fallbackAgentId = 'stub';
  agents: AgentProviderInfo[] = [{ agentId: 'stub', displayName: 'Stub Agent' }];
  readonly unavailableAgentIds = new Set<string>();
  readonly createdAgentIds: string[] = [];

  constructor(private readonly build: (agentId: string) => IAgentPort = StubAgentPortFactory.buildStub) {}

  get defaultAgentId(): string {
    this.defaultAgentIdReads += 1;
    return this.fallbackAgentId;
  }

  set defaultAgentId(agentId: string) {
    this.fallbackAgentId = agentId;
  }

  listAgents(): readonly AgentProviderInfo[] {
    return this.agents;
  }

  listAvailableAgents(): readonly AgentProviderInfo[] {
    return this.agents.filter(agent => this.isAgentAvailable(agent.agentId));
  }

  isAgentAvailable(agentId: string): boolean {
    return !this.unavailableAgentIds.has(agentId);
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
