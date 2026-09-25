import type { IAgentPort } from '../../agent/ports/agent.port.js';


export interface SessionContext {
  readonly sessionId: string;
  readonly channelId: string;
  readonly threadId?: string;
  readonly userId: string;
  readonly workspacePath: string;
  readonly agentRole: string;
  readonly agentPort: IAgentPort;
  readonly activeAgentPort: IAgentPort;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
