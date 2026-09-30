import type { AgentUsage } from '../../agent/ports/agent.port.js';

import type { TurnAgentInfo } from './turn-agent-info.model.js';


/** `steered`: the prompt joined the CEO round already running, whose result answers it. */
export type TurnStatus = 'completed' | 'cancelled' | 'failed' | 'steered';

export type TurnResult = {
  // Absent when the turn failed before its session was opened.
  sessionId?: string;
  response: string;
  status: TurnStatus;
  usage?: AgentUsage;
  errorMessage?: string;
  agentInfo?: TurnAgentInfo;
  attachments?: readonly string[];
};
