import type { AgentUsage } from '../../agent/ports/agent.port.js';


export type TurnStatus = 'completed' | 'cancelled' | 'failed';

export type TurnResult = {
  sessionId: string;
  response: string;
  status: TurnStatus;
  usage?: AgentUsage;
  errorMessage?: string;
};
