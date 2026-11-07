import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  type AgentProviderInfo,
  IAgentPortFactory,
} from '../../agent/ports/agent-port-factory.port.js';
import type { AgentQuota, AgentQuotaBucket } from '../../agent/ports/agent.port.js';
import type { AgentQuotaReport } from '../models/agent-quota-report.model.js';


const QUOTA_TIMEOUT_MS = 15_000;
const WINDOW_SPAN = /^(\d+)(m|h|d)$/;
const UNIT_MINUTES: Readonly<Record<string, number>> = { m: 1, h: 60, d: 1440 };
const NAMED_WINDOW_MINUTES: Readonly<Record<string, number>> = { weekly: 10_080, monthly: 43_200 };

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
      const pending = port.getQuota();
      // A query that loses the race may still reject after disconnect().
      pending.catch(() => undefined);
      const quota = await this.withTimeout(pending);
      return quota ? { agent, status: 'ok', quota: this.inWindowOrder(quota) } : { agent, status: 'unsupported' };
    } finally {
      await port.disconnect().catch(() => undefined);
    }
  }

  /** Each CLI lists its limits in its own order; every channel shows them shortest window first. */
  private inWindowOrder(quota: AgentQuota): AgentQuota {
    return {
      ...quota,
      groups: quota.groups.map(group => ({
        ...group,
        buckets: [...group.buckets].sort((a, b) => this.windowMinutes(a) - this.windowMinutes(b)),
      })),
    };
  }

  /** A window that states no duration, such as Claude's `limit`, sorts last. */
  private windowMinutes({ window }: AgentQuotaBucket): number {
    const span = WINDOW_SPAN.exec(window);
    return span ? Number(span[1]) * UNIT_MINUTES[span[2]!]! : NAMED_WINDOW_MINUTES[window] ?? Infinity;
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
