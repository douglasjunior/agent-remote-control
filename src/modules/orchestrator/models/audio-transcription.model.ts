import type { TurnAttachment } from './turn-attachment.model.js';


export type AudioTranscript = {
  readonly name: string;
  readonly text: string;
};

export type AudioTranscriptionResult = {
  /** The typed text followed by the transcripts. */
  readonly prompt: string;
  /** Attachments still to be delivered: everything that was not replaced by a transcript. */
  readonly attachments: readonly TurnAttachment[];
  readonly transcripts: readonly AudioTranscript[];
  /** User-facing notices about audio that stayed an attachment. */
  readonly warnings: readonly string[];
};
