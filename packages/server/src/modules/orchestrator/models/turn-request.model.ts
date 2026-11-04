import type { TurnTranscription } from './audio-transcription.model.js';
import type { DelegationEvent } from './delegation-event.model.js';
import type { TurnActivity } from './turn-activity.model.js';
import type { TurnAttachment } from './turn-attachment.model.js';
import type { QuestionPrompt } from './user-question.model.js';


export type TurnRequest = {
  conversationId: string;
  userId: string;
  prompt: string;
  workspacePath: string;
  agentRole: string;
  readonly attachments?: readonly TurnAttachment[];
  onActivity?: (activity: TurnActivity) => void;
  /**
   * The text of the CEO's response that the user reads, as far as it is written: whole at every call, replaced by
   * the next one, and empty when it is discarded. The finished response reaches the channel through the turn
   * result, `onInterimMessage` or `onQuestion`.
   */
  onDraft?: (text: string) => void;
  onDelegation?: (event: DelegationEvent) => void;
  onInterimMessage?: (message: string) => void;
  onQuestion?: (prompt: QuestionPrompt) => void;
  onQueued?: () => void;
  /** Called before the agents run, when audio attachments were transcribed or could not be. */
  onTranscription?: (transcription: TurnTranscription) => void;
};
