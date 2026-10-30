import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  type AgentProviderInfo,
  IAgentPortFactory,
} from '../../agent/ports/agent-port-factory.port.js';
import type { AgentQuotaReport } from '../models/agent-quota-report.model.js';


const QUOTA_TIMEOUT_MS = 15_000;

@Injectable()
export class GetAgentQuotaUseCase {
  private readonly logger = new Logger(GetAgentQuotaUseCase.name);

  constructor(
    @Inject(IAgentPortFactory)
    private readonly agentPortFactory: IAgentPortFactory,
  ) {}

  async execute(): Promise<readonly AgentQuotaReport[]> {
    const agents = this.agentPortFactory.listAvailableAgents();
    const outcomes = await Promise.allSettled(agents.map(agent => this.queryQuota(agent)));

    return outcomes.map((outcome, position): AgentQuotaReport => {
      if (outcome.status === 'fulfilled') {
        return outcome.value;
      }
      const { agentId, displayName } = agents[position]!;
      this.logger.warn(`quota_failed: agent=${agentId} reason=${String(outcome.reason)}`);
      return { agent: { id: agentId, name: displayName }, status: 'failed' };
    });
  }

  private async queryQuota({ agentId, displayName }: AgentProviderInfo): Promise<AgentQuotaReport> {
    const agent = { id: agentId, name: displayName };
    const port = this.agentPortFactory.create(agentId);
    try {
      const quota = await this.withTimeout(port.getQuota());
      return quota ? { agent, status: 'ok', quota } : { agent, status: 'unsupported' };
    } finally {
      await port.disconnect().catch(() => undefined);
    }
  }

  private async withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Quota query timed out after ${QUOTA_TIMEOUT_MS} ms`)),
        QUOTA_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
