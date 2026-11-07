import type { ClientCommand } from '@agent-remote-control/protocol/client-command';
import { Inject, Injectable } from '@nestjs/common';

import type { TurnAttachment } from '../../orchestrator/models/turn-attachment.model.js';
import type { QuestionAnswerInput } from '../../orchestrator/models/user-question.model.js';
import { IUserQuestionPort } from '../../orchestrator/ports/user-question.port.js';
import { ConversationEntryService } from '../services/conversation-entry.service.js';
import { WebConversationEventsService } from '../services/web-conversation-events.service.js';
import { WebConversationUploadsService } from '../services/web-conversation-uploads.service.js';

import { ResumeConversationWorkUseCase } from './resume-conversation-work.use-case.js';


const INVALID_ATTACHMENT_NOTICE = 'An attached file is missing. Attach it again and resend the answer.';

type QuestionAnswer = Extract<ClientCommand, { type: 'question.answer' }>['answer'];

@Injectable()
export class AnswerConversationQuestionUseCase {
  constructor(
    @Inject(IUserQuestionPort) private readonly userQuestions: IUserQuestionPort,
    private readonly events: WebConversationEventsService,
    private readonly resumeWork: ResumeConversationWorkUseCase,
    private readonly uploads: WebConversationUploadsService,
    private readonly entries: ConversationEntryService,
  ) {}

  /** Returns false when no question is waiting for an answer, closing the ones still shown as open. */
  async execute(conversationId: string, answer: QuestionAnswer): Promise<boolean> {
    const attachments = answer.kind === 'text' ? answer.attachments ?? [] : [];
    const files = await this.uploads.resolve(conversationId, attachments);
    if (!files) {
      await this.events.publishEntry(conversationId, this.entries.notice('error', INVALID_ATTACHMENT_NOTICE));
      return true;
    }
    const question = this.userQuestions.currentQuestion(conversationId)?.question;
    const submission = this.userQuestions.answerQuestion(conversationId, this.toInput(answer, files));
    if (!submission) {
      await this.events.closeUnanswerableQuestions(conversationId);
      return false;
    }
    await this.events.closeOpenQuestions(conversationId);
    const answerText = answer.kind === 'text' ? answer.text : question?.options[answer.optionIndex - 1];
    if (answerText !== undefined && submission.kind !== 'invalid') {
      await this.events.publishEntry(conversationId, this.entries.userMessage(answerText, attachments));
    }
    for (const entry of this.entries.submission(submission)) {
      await this.events.publishEntry(conversationId, entry);
    }
    if (submission.kind === 'answered' && submission.restoredWork) {
      void this.resumeWork.deliverAnswers(conversationId, submission.restoredWork);
    }
    return true;
  }

  private toInput(answer: QuestionAnswer, files: readonly TurnAttachment[]): QuestionAnswerInput {
    return answer.kind === 'text'
      ? { kind: 'text', text: answer.text, ...(files.length > 0 && { attachments: files }) }
      : answer;
  }
}
