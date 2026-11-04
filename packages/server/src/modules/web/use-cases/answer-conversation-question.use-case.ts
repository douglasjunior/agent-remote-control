import type { ClientCommand } from '@agent-remote-control/protocol/client-command';
import { Inject, Injectable } from '@nestjs/common';

import { IUserQuestionPort } from '../../orchestrator/ports/user-question.port.js';
import { WebConversationEventsService } from '../services/web-conversation-events.service.js';
import { submissionEntries, userMessageEntry } from '../utils/conversation-entry.util.js';


type QuestionAnswer = Extract<ClientCommand, { type: 'question.answer' }>['answer'];

@Injectable()
export class AnswerConversationQuestionUseCase {
  constructor(
    @Inject(IUserQuestionPort) private readonly userQuestions: IUserQuestionPort,
    private readonly events: WebConversationEventsService,
  ) {}

  /** Returns false, without side effects, when no question is waiting for an answer. */
  async execute(conversationId: string, answer: QuestionAnswer): Promise<boolean> {
    const question = this.userQuestions.currentQuestion(conversationId)?.question;
    const submission = this.userQuestions.answerQuestion(conversationId, answer);
    if (!submission) {
      return false;
    }
    const answerText = answer.kind === 'text' ? answer.text : question?.options[answer.optionIndex - 1];
    if (answerText !== undefined && submission.kind !== 'invalid') {
      await this.events.publishEntry(conversationId, userMessageEntry(answerText));
    }
    for (const entry of submissionEntries(submission)) {
      await this.events.publishEntry(conversationId, entry);
    }
    return true;
  }
}
