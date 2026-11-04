import { Inject, Injectable } from '@nestjs/common';

import type { TurnAttachment } from '../../orchestrator/models/turn-attachment.model.js';
import type { QuestionAnswerInput, QuestionSubmission, UserQuestion } from '../../orchestrator/models/user-question.model.js';
import { IAgentConfigurationPort } from '../../orchestrator/ports/agent-configuration.port.js';
import { IAgentTurnPort } from '../../orchestrator/ports/agent-turn.port.js';
import { IUserQuestionPort } from '../../orchestrator/ports/user-question.port.js';
import type { ConversationInputResolution, ResolvedConversationInput } from '../models/agent-config-outcome.model.js';
import { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';
import { LanguageChangeRequestService } from '../services/language-change-request.service.js';

import { StartAgentConfigSelectionUseCase } from './start-agent-config-selection.use-case.js';
import { SubmitAgentConfigSelectionUseCase } from './submit-agent-config-selection.use-case.js';


const ATTACHMENTS_ONLY_PROMPT = 'The user sent attachments. Analyze the attached files.';
const OPTION_NUMBER = /^\d+$/;

export type ResolveConversationInputInput = {
  readonly conversationId: string;
  /** Empty when the message carries only attachments. */
  readonly prompt: string;
  readonly attachments?: readonly TurnAttachment[];
};

/** Decides what a typed message means in a Discord conversation: an answer, a menu choice, a language or a prompt. */
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
    @Inject(IAgentTurnPort)
    private readonly agentTurn: IAgentTurnPort,
  ) {}

  async execute(input: ResolveConversationInputInput): Promise<ResolvedConversationInput> {
    const { prompt, attachments, transcripts, warnings } = await this.agentTurn.transcribeAudio({
      prompt: input.prompt,
      attachments: input.attachments,
    });
    const resolution = await this.resolve({
      conversationId: input.conversationId,
      prompt,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    const transcription = transcripts.length > 0 || warnings.length > 0 ? { transcription: { transcripts, warnings } } : {};
    const remaining = resolution.kind === 'execute' && attachments.length > 0 ? { attachments } : {};
    return { ...resolution, ...remaining, ...transcription };
  }

  private async resolve(input: ResolveConversationInputInput): Promise<ConversationInputResolution> {
    const { conversationId, attachments } = input;

    const question = this.userQuestions.currentQuestion(conversationId)?.question;
    if (question) {
      const submission = this.userQuestions.answerQuestion(conversationId, this.readAnswer(question, input.prompt, attachments));
      return this.describeSubmission(submission!);
    }

    if (this.languageChangeRequests.isPending(conversationId)) {
      return this.changeLanguage(conversationId, input.prompt);
    }

    const prompt = input.prompt || ATTACHMENTS_ONLY_PROMPT;

    if (await this.selectionStore.find(conversationId)) {
      const outcome = await this.submitSelection.execute({ conversationId, input: prompt });
      if (outcome.kind !== 'configured') {
        return outcome;
      }
      if (outcome.pendingPrompt) {
        return { kind: 'execute', prompt: outcome.pendingPrompt, configured: outcome.settings };
      }
      return { kind: 'configured', settings: outcome.settings };
    }

    if (await this.configuration.ensureSettings(conversationId) !== 'missing') {
      return { kind: 'execute', prompt };
    }

    const started = await this.startSelection.execute({ conversationId, pendingPrompt: prompt, step: 'agent' });
    if (started.kind === 'unavailable') {
      return { kind: 'execute', prompt };
    }
    return started;
  }

  /** A whole number picks an option of a question that has them; any other text is the user's own answer. */
  private readAnswer(question: UserQuestion, text: string, attachments?: readonly TurnAttachment[]): QuestionAnswerInput {
    const files = attachments?.length ? { attachments } : {};
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
