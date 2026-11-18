import type { Deadline } from './countdown.model.js';
import type { TurnAttachment } from './turn-attachment.model.js';


/** What a channel shows while a failed prompt of the CEO waits to be sent again. */
export type RetryPrompt = {
  readonly roleName: string;
  readonly errorMessage: string;
  /** The number of the retry the wait leads to, from 1. */
  readonly attempt: number;
  /** When the retry happens without anyone asking for it. */
  readonly timeout: Deadline;
};

/** `elapsed`: the time passed; `requested`: the user asked for it now; `stopped`: the user ended the retries; `cancelled`: the turn was cancelled. */
export type RetryReason = 'elapsed' | 'requested' | 'stopped' | 'cancelled';

/** What a channel hears about the retries of its turn. */
export type RetryEvent =
  | { readonly kind: 'scheduled'; readonly prompt: RetryPrompt }
  | { readonly kind: 'ended'; readonly reason: RetryReason };

export type RetryListener = {
  readonly scheduled: (prompt: RetryPrompt) => void;
  readonly ended: (reason: RetryReason) => void;
};

/** What the user wrote to ask for a retry now; the CEO reads it with the retry. */
export type RetryMessage = {
  readonly text: string;
  readonly attachments?: readonly TurnAttachment[];
};

/** How a wait ended: the prompt is sent again, with what the user wrote to ask for it, or the failure stands. */
export type RetryDecision =
  | { readonly kind: 'retry'; readonly message?: RetryMessage }
  | { readonly kind: 'stop' };

/** What a prompt is sent again with: the error that stopped it and what the user wrote while it waited, already prepared like any message. */
export type RetryNote = {
  readonly errorMessage: string;
  readonly userMessage?: string;
};
