import type { AgentSession } from './agent-session.model.js';


export interface SessionContext {
  readonly sessionId: string;
  readonly channelId: string;
  readonly threadId?: string;
  readonly userId: string;
  readonly workspacePath: string;
  readonly agentRole: string;
  readonly agentSessions: readonly AgentSession[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
