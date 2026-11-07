import type { TurnAttachment } from '../../orchestrator/models/turn-attachment.model.js';


/** The message that opened a conversation without settings, kept while the user picks an agent so it runs afterwards. */
export type PendingMessage = {
  /** The text as typed; empty when the message carried only attachments. */
  readonly prompt: string;
  readonly attachments: readonly TurnAttachment[];
};
