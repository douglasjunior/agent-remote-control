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
    const submission = this.userQuestions.answerQuestion(conversationId, answer);
    if (!submission) {
      return false;
    }
    if (answer.kind === 'text') {
      await this.events.publishEntry(conversationId, userMessageEntry(answer.text));
    }
    for (const entry of submissionEntries(submission)) {
      await this.events.publishEntry(conversationId, entry);
    }
    return true;
  }
}
