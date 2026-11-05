import { Inject, Injectable } from '@nestjs/common';

import type { AgentQuotaReport } from '../../orchestrator/models/agent-quota-report.model.js';
import { IAgentTurnPort } from '../../orchestrator/ports/agent-turn.port.js';


/** Shorter than the client's 5-minute refresh, so each refresh finds an expired entry and brings new numbers. */
export const QUOTA_CACHE_TTL_MS = 240_000;

export type AgentQuotaSnapshot = {
  readonly reports: readonly AgentQuotaReport[];
  readonly fetchedAt: string;
};

/**
 * The agents' usage for an indicator that is always on screen. Every query starts the agents' CLIs, so a
 * result is reused for a while and all connections share the query in progress.
 */
@Injectable()
export class WebAgentQuotaService {
  private snapshot?: AgentQuotaSnapshot;
  private pending?: Promise<AgentQuotaSnapshot>;

  constructor(@Inject(IAgentTurnPort) private readonly agentTurn: IAgentTurnPort) {}

  read(refresh = false): Promise<AgentQuotaSnapshot> {
    if (this.pending) {
      return this.pending;
    }
    if (!refresh && this.snapshot && Date.now() - Date.parse(this.snapshot.fetchedAt) < QUOTA_CACHE_TTL_MS) {
      return Promise.resolve(this.snapshot);
    }
    this.pending = this.query().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async query(): Promise<AgentQuotaSnapshot> {
    const reports = await this.agentTurn.getQuota();
    this.snapshot = { reports, fetchedAt: new Date().toISOString() };
    return this.snapshot;
  }
}
