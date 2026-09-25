import { Inject, Injectable } from '@nestjs/common';

import { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import type {
  AgentEffortState,
  AgentModelState,
  IAgentPort,
} from '../../agent/ports/agent.port.js';


@Injectable()
export class AgentCapabilitiesService {
  constructor(
    @Inject(IAgentPortFactory)
    private readonly agentPortFactory: IAgentPortFactory,
  ) {}

  listModels(): Promise<AgentModelState | null> {
    return this.withProbe(async port => port.getAvailableModels());
  }

  listEfforts(modelId: string): Promise<AgentEffortState | null> {
    return this.withProbe(port => port.getAvailableEffortsForModel(modelId));
  }

  private async withProbe<T>(read: (port: IAgentPort) => Promise<T>): Promise<T> {
    const port = this.agentPortFactory.create();
    try {
      await port.connect();
      return await read(port);
    } finally {
      await port.disconnect().catch(() => undefined);
    }
  }
}
