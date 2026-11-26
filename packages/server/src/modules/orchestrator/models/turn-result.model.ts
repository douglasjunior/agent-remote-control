import type { AgentUsage } from '../../agent/ports/agent.port.js';

import type { TurnAgentInfo } from './turn-agent-info.model.js';


/** `steered`: the message joined the turn already running, steered into its CEO prompt or read with a later one; that turn's result answers it. */
export type TurnStatus = 'completed' | 'cancelled' | 'failed' | 'steered';

export type TurnResult = {
  response: string;
  status: TurnStatus;
  usage?: AgentUsage;
  errorMessage?: string;
  agentInfo?: TurnAgentInfo;
  attachments?: readonly string[];
};
