import type { AgentUsage } from '../../agent/ports/agent.port.js';

import type { TurnAgentInfo } from './turn-agent-info.model.js';


type DelegationEventBase = {
  readonly delegationId: string;
  readonly round: number;
  readonly role: string;
  readonly roleName: string;
  readonly projectName?: string;
  readonly artifactId?: string;
  readonly summary: string;
  /** The task as the CEO wrote it for the agent. */
  readonly taskSpec: string;
};

export type DelegationEvent =
  | DelegationEventBase & { readonly phase: 'started' }
  | DelegationEventBase & {
    readonly phase: 'finished';
    readonly response: string;
    readonly agentInfo: TurnAgentInfo;
    readonly usage?: AgentUsage;
    readonly durationMs: number;
  }
  | DelegationEventBase & {
    readonly phase: 'failed';
    readonly errorMessage: string;
    readonly durationMs: number;
  }
  | DelegationEventBase & {
    readonly phase: 'cancelled';
    readonly durationMs: number;
  };
