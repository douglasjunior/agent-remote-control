import type { ClientCommand } from '@agent-remote-control/protocol/client-command';
import { Inject, Injectable } from '@nestjs/common';

import { IUserQuestionPort } from '../../orchestrator/ports/user-question.port.js';
import { WebConversationEventsService } from '../services/web-conversation-events.service.js';
import { submissionEntries, userMessageEntry } from '../utils/conversation-entry.util.js';

import { ResumeConversationWorkUseCase } from './resume-conversation-work.use-case.js';


type QuestionAnswer = Extract<ClientCommand, { type: 'question.answer' }>['answer'];

@Injectable()
export class AnswerConversationQuestionUseCase {
  constructor(
    @Inject(IUserQuestionPort) private readonly userQuestions: IUserQuestionPort,
    private readonly events: WebConversationEventsService,
    private readonly resumeWork: ResumeConversationWorkUseCase,
  ) {}

  /** Returns false when no question is waiting for an answer, closing the ones still shown as open. */
  async execute(conversationId: string, answer: QuestionAnswer): Promise<boolean> {
    const question = this.userQuestions.currentQuestion(conversationId)?.question;
    const submission = this.userQuestions.answerQuestion(conversationId, answer);
    if (!submission) {
      await this.events.closeUnanswerableQuestions(conversationId);
      return false;
    }
    await this.events.closeOpenQuestions(conversationId);
    const answerText = answer.kind === 'text' ? answer.text : question?.options[answer.optionIndex - 1];
    if (answerText !== undefined && submission.kind !== 'invalid') {
      await this.events.publishEntry(conversationId, userMessageEntry(answerText));
    }
    for (const entry of submissionEntries(submission)) {
      await this.events.publishEntry(conversationId, entry);
    }
    if (submission.kind === 'answered' && submission.restoredWork) {
      void this.resumeWork.deliverAnswers(conversationId, submission.restoredWork);
    }
    return true;
  }
}
