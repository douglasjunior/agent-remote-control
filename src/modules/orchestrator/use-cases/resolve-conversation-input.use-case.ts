import { Inject, Injectable } from '@nestjs/common';

import type { ConversationInputResolution, ResolvedConversationInput } from '../models/agent-config-outcome.model.js';
import type { TurnAttachment } from '../models/turn-attachment.model.js';
import type { QuestionSubmission } from '../models/user-question.model.js';
import { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';
import { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';
import { IPreferencesStorePort } from '../ports/preferences-store.port.js';
import { LanguageChangeRequestService } from '../services/language-change-request.service.js';
import { UserQuestionQueueService } from '../services/user-question-queue.service.js';
import { normalizeUserLanguage } from '../utils/user-language.util.js';

import { StartAgentConfigSelectionUseCase } from './start-agent-config-selection.use-case.js';
import { SubmitAgentConfigSelectionUseCase } from './submit-agent-config-selection.use-case.js';
import { TranscribeAudioAttachmentsUseCase } from './transcribe-audio-attachments.use-case.js';


const ATTACHMENTS_ONLY_PROMPT = 'The user sent attachments. Analyze the attached files.';

export type ResolveConversationInputInput = {
  readonly conversationId: string;
  /** Empty when the message carries only attachments. */
  readonly prompt: string;
  readonly attachments?: readonly TurnAttachment[];
};

@Injectable()
export class ResolveConversationInputUseCase {
  constructor(
    @Inject(IAgentConfigSelectionStorePort)
    private readonly selectionStore: IAgentConfigSelectionStorePort,
    @Inject(IAgentSettingsStorePort)
    private readonly settingsStore: IAgentSettingsStorePort,
    private readonly startSelection: StartAgentConfigSelectionUseCase,
    private readonly submitSelection: SubmitAgentConfigSelectionUseCase,
    private readonly questionQueue: UserQuestionQueueService,
    private readonly languageChangeRequests: LanguageChangeRequestService,
    @Inject(IPreferencesStorePort)
    private readonly preferencesStore: IPreferencesStorePort,
    private readonly transcribeAudioAttachments: TranscribeAudioAttachmentsUseCase,
  ) {}

  async execute(input: ResolveConversationInputInput): Promise<ResolvedConversationInput> {
    const { prompt, attachments, transcripts, warnings } = await this.transcribeAudioAttachments.execute(input);
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

    const submission = this.questionQueue.submit(conversationId, { text: input.prompt, attachments });
    if (submission) {
      return this.describeSubmission(submission);
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

    if (await this.settingsStore.load(conversationId)) {
      return { kind: 'execute', prompt };
    }

    const mostRecent = await this.settingsStore.loadMostRecent();
    if (mostRecent) {
      await this.settingsStore.save(conversationId, {
        ...mostRecent,
        updatedAt: new Date().toISOString(),
      });
      return { kind: 'execute', prompt };
    }

    const started = await this.startSelection.execute({ conversationId, pendingPrompt: prompt, step: 'agent' });
    if (started.kind === 'unavailable') {
      return { kind: 'execute', prompt };
    }
    return started;
  }

  private async changeLanguage(conversationId: string, input: string): Promise<ConversationInputResolution> {
    const language = normalizeUserLanguage(input);
    if (!language) {
      return { kind: 'invalid_language' };
    }
    this.languageChangeRequests.cancel(conversationId);
    await this.preferencesStore.update({ language });
    return { kind: 'language_set', language };
  }

  private describeSubmission(submission: QuestionSubmission): ConversationInputResolution {
    if (submission.kind === 'answered') {
      return submission;
    }
    return { kind: submission.kind === 'next' ? 'question' : 'invalid_answer', prompt: submission.prompt };
  }
}
