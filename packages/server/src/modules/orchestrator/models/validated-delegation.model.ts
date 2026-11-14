import type { CeoDecision, DelegationResult } from '../services/delegation-detector.service.js';

import type { OpenWorkQuestions } from './open-work.model.js';


/**
 * Answers on their way to an agent that asked before a restart. The record keeps the questions until the prompt is sent,
 * so a restart before that asks them again; from then on the agent has them and is simply working.
 */
export type AnswerDelivery = {
  readonly workId: string;
  readonly questions: OpenWorkQuestions;
  /** The first prompt does not carry the task, which a session created in place of the lost one would not know. */
  readonly taskSpec: string;
};

/** A delegation that passed every check, with the folder its agent runs in. */
export type ValidatedDelegation = DelegationResult & {
  readonly cwd: string;
  /** Present on a delegation resumed after a restart, which keeps the id of the one it continues. */
  readonly workId?: string;
  /** What the agent receives first, in place of the task. */
  readonly firstPrompt?: string;
  readonly answerDelivery?: AnswerDelivery;
};

export type ValidatedDecision =
  | Exclude<CeoDecision, { kind: 'delegate' }>
  | { readonly kind: 'delegate'; readonly message: string; readonly delegations: readonly ValidatedDelegation[] };
