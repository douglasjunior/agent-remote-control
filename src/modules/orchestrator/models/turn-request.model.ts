import type { AgentActivity } from '../../agent/ports/agent.port.js';

import type { DelegationEvent } from './delegation-event.model.js';
import type { TurnAttachment } from './turn-attachment.model.js';
import type { QuestionPrompt } from './user-question.model.js';


export type TurnRequest = {
  conversationId: string;
  userId: string;
  prompt: string;
  workspacePath: string;
  agentRole: string;
  readonly attachments?: readonly TurnAttachment[];
  onActivity?: (activity: AgentActivity) => void;
  onTextChunk?: (chunk: string) => void;
  onDelegation?: (event: DelegationEvent) => void;
  onInterimMessage?: (message: string) => void;
  onQuestion?: (prompt: QuestionPrompt) => void;
  onQueued?: () => void;
};
