import { Injectable } from '@nestjs/common';

import type { QuestionAnswerInput, QuestionPrompt, QuestionSubmission } from '../models/user-question.model.js';
import type { IUserQuestionPort } from '../ports/user-question.port.js';

import { UserQuestionQueueService } from './user-question-queue.service.js';


@Injectable()
export class UserQuestionService implements IUserQuestionPort {
  constructor(private readonly questionQueue: UserQuestionQueueService) {}

  hasPendingQuestions(conversationId: string): boolean {
    return this.questionQueue.hasPending(conversationId);
  }

  currentQuestion(conversationId: string): QuestionPrompt | undefined {
    return this.questionQueue.current(conversationId);
  }

  answerQuestion(conversationId: string, answer: QuestionAnswerInput): QuestionSubmission | undefined {
    return this.questionQueue.submit(conversationId, answer);
  }
}
