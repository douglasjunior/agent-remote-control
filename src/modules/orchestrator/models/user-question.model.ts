import type { TurnAttachment } from './turn-attachment.model.js';


export type UserQuestion = {
  readonly text: string;
  readonly rationale?: string;
  readonly options: readonly string[];
};

export type QuestionAsker = {
  readonly role: string;
  readonly roleName: string;
  readonly projectName: string | null;
};

/** `optionNumber` is the 1-based option the user picked; absent when they typed their own answer. */
export type AnsweredQuestion = {
  readonly question: UserQuestion;
  readonly answer: string;
  readonly optionNumber?: number;
  readonly attachments?: readonly TurnAttachment[];
};

export type QuestionAnswerInput = {
  readonly text: string;
  readonly attachments?: readonly TurnAttachment[];
};

export type QuestionPrompt = {
  readonly asker: QuestionAsker;
  readonly question: UserQuestion;
  readonly number: number;
  readonly total: number;
  /** The asking agent's text around its questions, shown before the first one. */
  readonly message?: string;
  readonly waitingAskers: number;
};

export type QuestionSubmission =
  | { readonly kind: 'next'; readonly prompt: QuestionPrompt }
  | { readonly kind: 'invalid'; readonly prompt: QuestionPrompt }
  | { readonly kind: 'answered'; readonly asker: QuestionAsker; readonly next?: QuestionPrompt };
