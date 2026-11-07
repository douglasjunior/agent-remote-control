import type { AgentAuthStatus } from '../../agent/models/agent-auth.model.js';


export type AgentAuthChoice = {
  readonly agentId: string;
  readonly displayName: string;
};

export type AgentAuthMenuEntry = AgentAuthChoice & {
  readonly index: number;
  readonly status: AgentAuthStatus;
  readonly detail?: string;
};
