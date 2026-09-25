export type SessionContext = {
  sessionId: string;
  channelId: string;
  threadId?: string;
  userId: string;
  workspacePath: string;
  agentId?: string;
  createdAt: Date;
  updatedAt: Date;
};
