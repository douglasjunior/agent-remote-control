import { Inject, Injectable } from '@nestjs/common';

import type { AgentSettings } from '../../orchestrator/models/agent-settings.model.js';
import type { TurnAttachment } from '../../orchestrator/models/turn-attachment.model.js';
import type { QuestionAnswerInput, QuestionSubmission, UserQuestion } from '../../orchestrator/models/user-question.model.js';
import { IAgentConfigurationPort } from '../../orchestrator/ports/agent-configuration.port.js';
import { IUserQuestionPort } from '../../orchestrator/ports/user-question.port.js';
import type { ConversationInputResolution } from '../models/agent-config-outcome.model.js';
import { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';
import { LanguageChangeRequestService } from '../services/language-change-request.service.js';

import { StartAgentConfigSelectionUseCase } from './start-agent-config-selection.use-case.js';
import { SubmitAgentConfigSelectionUseCase } from './submit-agent-config-selection.use-case.js';


const OPTION_NUMBER = /^\d+$/;

export type ResolveConversationInputInput = {
  readonly conversationId: string;
  /** The text as typed; empty when the message carries only attachments. */
  readonly prompt: string;
  /** The files of the message, already fetched by the channel. */
  readonly attachments?: readonly TurnAttachment[];
};

/**
 * Decides what a typed message means in a Discord conversation: an answer, a menu choice, a language or a
 * prompt for the agents. The text is taken as typed, and the attachments travel untouched to wherever the
 * message ends up: what a turn does with them, audio included, is the orchestrator's business.
 */
@Injectable()
export class ResolveConversationInputUseCase {
  constructor(
    @Inject(IAgentConfigSelectionStorePort)
    private readonly selectionStore: IAgentConfigSelectionStorePort,
    @Inject(IAgentConfigurationPort)
    private readonly configuration: IAgentConfigurationPort,
    private readonly startSelection: StartAgentConfigSelectionUseCase,
    private readonly submitSelection: SubmitAgentConfigSelectionUseCase,
    @Inject(IUserQuestionPort)
    private readonly userQuestions: IUserQuestionPort,
    private readonly languageChangeRequests: LanguageChangeRequestService,
  ) {}

  async execute(input: ResolveConversationInputInput): Promise<ConversationInputResolution> {
    const { conversationId, prompt } = input;
    const attachments = input.attachments ?? [];

    const question = this.userQuestions.currentQuestion(conversationId)?.question;
    if (question) {
      const submission = this.userQuestions.answerQuestion(conversationId, this.readAnswer(question, prompt, attachments));
      return this.describeSubmission(submission!);
    }

    if (this.languageChangeRequests.isPending(conversationId)) {
      return this.changeLanguage(conversationId, prompt);
    }

    if (await this.selectionStore.find(conversationId)) {
      const outcome = await this.submitSelection.execute({ conversationId, input: prompt });
      if (outcome.kind !== 'configured') {
        return outcome;
      }
      if (outcome.pendingMessage) {
        return this.execution(outcome.pendingMessage.prompt, outcome.pendingMessage.attachments, outcome.settings);
      }
      return { kind: 'configured', settings: outcome.settings };
    }

    if (await this.configuration.ensureSettings(conversationId) !== 'missing') {
      return this.execution(prompt, attachments);
    }

    const started = await this.startSelection.execute({ conversationId, pendingMessage: { prompt, attachments }, step: 'agent' });
    if (started.kind === 'unavailable') {
      return this.execution(prompt, attachments);
    }
    return started;
  }

  private execution(prompt: string, attachments: readonly TurnAttachment[], configured?: AgentSettings): ConversationInputResolution {
    return {
      kind: 'execute',
      prompt,
      ...(configured && { configured }),
      ...(attachments.length > 0 && { attachments }),
    };
  }

  /** A whole number picks an option of a question that has them; any other text is the user's own answer. */
  private readAnswer(question: UserQuestion, text: string, attachments: readonly TurnAttachment[]): QuestionAnswerInput {
    const files = attachments.length > 0 ? { attachments } : {};
    const trimmed = text.trim();
    if (question.options.length > 0 && OPTION_NUMBER.test(trimmed)) {
      return { kind: 'option', optionIndex: Number(trimmed), ...files };
    }
    return { kind: 'text', text, ...files };
  }

  private async changeLanguage(conversationId: string, input: string): Promise<ConversationInputResolution> {
    const language = await this.configuration.setLanguage(input);
    if (!language) {
      return { kind: 'invalid_language' };
    }
    this.languageChangeRequests.cancel(conversationId);
    return { kind: 'language_set', language };
  }

  private describeSubmission(submission: QuestionSubmission): ConversationInputResolution {
    if (submission.kind === 'answered') {
      return submission;
    }
    return { kind: submission.kind === 'next' ? 'question' : 'invalid_answer', prompt: submission.prompt };
  }
}
