import type { AgentAuthInfo } from '@agent-remote-control/protocol/agent-auth';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { IAgentAuthPort } from '../../agent/ports/agent-auth.port.js';
import type { IClientConnection } from '../ports/client-transport.port.js';

import { WebConnectionRegistryService } from './web-connection-registry.service.js';


/** Shorter than the client's 5-minute refresh, so each refresh finds an expired entry and brings the current state. */
export const AUTH_STATUS_CACHE_TTL_MS = 120_000;

export type AgentAuthSnapshot = {
  readonly agents: readonly AgentAuthInfo[];
  readonly fetchedAt: string;
};

/**
 * Login state of the agent CLIs for the web interface, and the logins started from it. Reading the state
 * starts CLIs, so a result is reused for a while and all connections share the query in progress. Login
 * progress goes to every open connection: whoever started it, any tab shows the same link and result.
 */
@Injectable()
export class WebAgentAuthService {
  private readonly logger = new Logger(WebAgentAuthService.name);
  private snapshot?: AgentAuthSnapshot;
  private pending?: Promise<AgentAuthSnapshot>;

  constructor(
    @Inject(IAgentAuthPort) private readonly agentAuth: IAgentAuthPort,
    private readonly registry: WebConnectionRegistryService,
  ) {}

  read(refresh = false): Promise<AgentAuthSnapshot> {
    if (this.pending) {
      return this.pending;
    }
    if (!refresh && this.snapshot && Date.now() - Date.parse(this.snapshot.fetchedAt) < AUTH_STATUS_CACHE_TTL_MS) {
      return Promise.resolve(this.snapshot);
    }
    this.pending = this.query().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  login(requester: IClientConnection, agentId: string): void {
    try {
      this.agentAuth.startLogin(agentId, (event) => {
        this.registry.broadcast({ type: 'auth.login', agentId, event });
        if (event.kind === 'completed') {
          void this.publishStatus();
        }
      });
    } catch (error) {
      requester.send({
        type: 'auth.login',
        agentId,
        event: { kind: 'failed', reason: error instanceof Error ? error.message : 'The login could not start.' },
      });
    }
  }

  submitInput(agentId: string, text: string): boolean {
    return this.agentAuth.submitInput(agentId, text);
  }

  cancel(agentId: string): void {
    this.agentAuth.cancelLogin(agentId);
  }

  private async query(): Promise<AgentAuthSnapshot> {
    const agents = await this.agentAuth.listAuthInfo();
    this.snapshot = { agents, fetchedAt: new Date().toISOString() };
    return this.snapshot;
  }

  private async publishStatus(): Promise<void> {
    try {
      const { agents, fetchedAt } = await this.read(true);
      this.registry.broadcast({ type: 'auth.status', agents, fetchedAt });
    } catch (error) {
      this.logger.warn(`auth_status_failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
