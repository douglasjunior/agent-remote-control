import type { AgentSession } from './agent-session.model.js';


export interface SessionContext {
  readonly conversationId: string;
  readonly agentSessions: readonly AgentSession[];
}
