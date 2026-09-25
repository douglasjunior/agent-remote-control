export interface SessionContext {
  readonly sessionId: string;
  readonly channelId: string;
  readonly threadId?: string;
  readonly userId: string;
  readonly workspacePath: string;
  readonly agentRole: string;
  readonly agentSessionId?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
