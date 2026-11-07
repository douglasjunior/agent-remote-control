import type { QuestionAnswerInput, QuestionPrompt, QuestionSubmission } from '../models/user-question.model.js';


/** The questions agents ask the user. The channel decides how the user reads and answers them. */
export interface IUserQuestionPort {
  hasPendingQuestions(conversationId: string): boolean;
  currentQuestion(conversationId: string): QuestionPrompt | undefined;
  /** `undefined` when the conversation has no question waiting. */
  answerQuestion(conversationId: string, answer: QuestionAnswerInput): QuestionSubmission | undefined;
}

export const IUserQuestionPort = Symbol('IUserQuestionPort');
