import type { AgentActivity } from '../../agent/ports/agent.port.js';


export type TurnRequest = {
  channelId: string;
  threadId?: string;
  userId: string;
  prompt: string;
  workspacePath: string;
  agentRole: string;
  onActivity?: (activity: AgentActivity) => void;
  onTextChunk?: (chunk: string) => void;
};
