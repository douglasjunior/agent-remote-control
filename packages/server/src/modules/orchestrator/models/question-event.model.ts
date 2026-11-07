import type {
  AnsweredQuestion,
  QuestionAsker,
  QuestionPrompt,
} from './user-question.model.js';


/** A question the user left unanswered for `timeoutMs`. `next` is the question that follows it, if any. */
export type QuestionTimedOut = {
  readonly asker: QuestionAsker;
  readonly answered: AnsweredQuestion;
  readonly timeoutMs: number;
  readonly next?: QuestionPrompt;
};

/** What a channel hears about the questions of its turn. */
export type QuestionEvent =
  | { readonly kind: 'asked'; readonly prompt: QuestionPrompt }
  | ({ readonly kind: 'timedOut' } & QuestionTimedOut);

/** What the question queue reports about one request. */
export type QuestionListener = {
  /** The first question reached the front of the queue on its own, rather than through the previous answer. */
  readonly asked: (prompt: QuestionPrompt) => void;
  readonly timedOut: (timedOut: QuestionTimedOut) => void;
  /** Only requests whose answers are kept on disk have it: the answers so far, while questions remain. */
  readonly answersChanged?: (answers: readonly AnsweredQuestion[]) => void;
};
