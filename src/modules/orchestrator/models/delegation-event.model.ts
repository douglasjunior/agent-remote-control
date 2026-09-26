import type { AgentUsage } from '../../agent/ports/agent.port.js';

import type { TurnAgentInfo } from './turn-agent-info.model.js';


type DelegationEventBase = {
  readonly round: number;
  readonly role: string;
  readonly roleName: string;
  readonly projectName?: string;
};

export type DelegationEvent =
  | DelegationEventBase & { readonly phase: 'started' }
  | DelegationEventBase & {
    readonly phase: 'finished';
    readonly response: string;
    readonly agentInfo: TurnAgentInfo;
    readonly usage?: AgentUsage;
    readonly durationMs: number;
  };
