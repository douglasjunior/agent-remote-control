import type { TurnTranscription } from './audio-transcription.model.js';
import type { UserMessageDelivery } from './conversation-turn.model.js';
import type { DelegationEvent } from './delegation-event.model.js';
import type { QuestionEvent } from './question-event.model.js';
import type { TurnActivity } from './turn-activity.model.js';
import type { TurnAttachment } from './turn-attachment.model.js';
import type { RetryEvent } from './turn-retry.model.js';


export type TurnRequest = {
  conversationId: string;
  userId: string;
  prompt: string;
  workspacePath: string;
  agentRole: string;
  readonly attachments?: readonly TurnAttachment[];
  /** Keeps the work of this turn on disk, so a restart leaves it resumable through `IAgentTurnPort.resumeWork`. */
  readonly resumable?: boolean;
  /** `role` is the agent whose activity it is. */
  onActivity?: (activity: TurnActivity, role: string) => void;
  /**
   * The text of the CEO's response that the user reads, as far as it is written: whole at every call, replaced by
   * the next one, and empty when it is discarded. The finished response reaches the channel through the turn
   * result, `onInterimMessage` or `onQuestion`.
   */
  onDraft?: (text: string) => void;
  onDelegation?: (event: DelegationEvent) => void;
  onInterimMessage?: (message: string) => void;
  /** A question of this turn reached the front of the queue, or was answered on the user's behalf after the timeout. */
  onQuestion?: (event: QuestionEvent) => void;
  /** A failed round of the CEO waits to be tried again, or that wait ended. */
  onRetry?: (event: RetryEvent) => void;
  /**
   * How the message reached the CEO when a turn was already running: `queued` first while it waits, then `steered`,
   * `delivered` or `cancelled`. A message that starts a turn of its own hears nothing; one that waited and then starts
   * the next turn hears `delivered` when the CEO reads it.
   */
  onDelivery?: (delivery: UserMessageDelivery) => void;
  /** Called before the agents run, when audio attachments were transcribed or could not be. */
  onTranscription?: (transcription: TurnTranscription) => void;
};
