import type { AgentActivity } from '../../agent/ports/agent.port.js';

import type { DelegationEvent } from './delegation-event.model.js';
import type { TurnAttachment } from './turn-attachment.model.js';


export type TurnRequest = {
  channelId: string;
  threadId?: string;
  userId: string;
  prompt: string;
  workspacePath: string;
  agentRole: string;
  readonly attachments?: readonly TurnAttachment[];
  onActivity?: (activity: AgentActivity) => void;
  onTextChunk?: (chunk: string) => void;
  onDelegation?: (event: DelegationEvent) => void;
  onQueued?: () => void;
};
