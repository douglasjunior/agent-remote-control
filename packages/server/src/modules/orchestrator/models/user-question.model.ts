import type { TurnAttachment } from './turn-attachment.model.js';


export type UserQuestion = {
  readonly text: string;
  readonly rationale?: string;
  readonly options: readonly string[];
  /** 1-based option the agent recommends; assumed when the user does not answer in time. */
  readonly recommendedIndex?: number;
};

export type QuestionAsker = {
  readonly role: string;
  readonly roleName: string;
  readonly projectName: string | null;
};

/**
 * `optionNumber` is the 1-based option picked; absent when the user typed their own answer. `timedOut` marks a
 * question the user left unanswered: the recommended option stands in for the answer, and a question without one is
 * answered with nothing (empty `answer`, no `optionNumber`).
 */
export type AnsweredQuestion = {
  readonly question: UserQuestion;
  readonly answer: string;
  readonly optionNumber?: number;
  readonly timedOut?: true;
  readonly attachments?: readonly TurnAttachment[];
};

/** `option` picks the 1-based option of a question that has options; `text` is the user's own answer. */
export type QuestionAnswerInput = (
  | { readonly kind: 'option'; readonly optionIndex: number }
  | { readonly kind: 'text'; readonly text: string }
) & { readonly attachments?: readonly TurnAttachment[] };

export type QuestionDeadline = {
  /** Epoch milliseconds. */
  readonly expiresAt: number;
  readonly durationMs: number;
};

export type QuestionPrompt = {
  readonly asker: QuestionAsker;
  readonly question: UserQuestion;
  readonly number: number;
  readonly total: number;
  /** The asking agent's text around its questions, shown before the first one. */
  readonly message?: string;
  readonly waitingAskers: number;
  /** When the question times out; absent when the timeout is disabled. */
  readonly timeout?: QuestionDeadline;
};

export type RestoredWorkAnswers = {
  readonly workId: string;
  readonly answers: readonly AnsweredQuestion[];
};

export type QuestionSubmission =
  | { readonly kind: 'next'; readonly prompt: QuestionPrompt }
  | { readonly kind: 'invalid'; readonly prompt: QuestionPrompt }
  | {
    readonly kind: 'answered';
    readonly asker: QuestionAsker;
    readonly next?: QuestionPrompt;
    /** Present on a request restored after a restart: no turn is waiting for these answers, so the channel delivers them. */
    readonly restoredWork?: RestoredWorkAnswers;
  };
