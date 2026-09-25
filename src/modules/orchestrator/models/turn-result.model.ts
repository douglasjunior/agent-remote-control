import type { AgentUsage } from '../../agent/ports/agent.port.js';

import type { TurnAgentInfo } from './turn-agent-info.model.js';


export type TurnStatus = 'completed' | 'cancelled' | 'failed';

export type TurnResult = {
  sessionId: string;
  response: string;
  status: TurnStatus;
  usage?: AgentUsage;
  errorMessage?: string;
  agentInfo?: TurnAgentInfo;
};
