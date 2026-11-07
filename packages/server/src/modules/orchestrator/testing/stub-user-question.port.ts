import type { QuestionAnswerInput, QuestionPrompt, QuestionSubmission } from '../models/user-question.model.js';
import type { IUserQuestionPort } from '../ports/user-question.port.js';


export class StubUserQuestionPort implements IUserQuestionPort {
  /** The question waiting for the user; when set, the conversation has a pending question. */
  prompt?: QuestionPrompt;
  /** Forces `hasPendingQuestions` without a prompt. */
  pending?: boolean;
  /** What answering returns; `undefined` behaves as "no question waiting". */
  submission?: QuestionSubmission;

  readonly pendingLookups: string[] = [];
  readonly answers: { conversationId: string; answer: QuestionAnswerInput }[] = [];

  hasPendingQuestions(conversationId: string): boolean {
    this.pendingLookups.push(conversationId);
    return this.pending ?? this.prompt !== undefined;
  }

  currentQuestion(): QuestionPrompt | undefined {
    return this.prompt;
  }

  answerQuestion(conversationId: string, answer: QuestionAnswerInput): QuestionSubmission | undefined {
    this.answers.push({ conversationId, answer });
    return this.submission;
  }
}
