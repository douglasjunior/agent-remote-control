import { Inject, Injectable } from '@nestjs/common';

import type { ConversationInputResolution } from '../models/agent-config-outcome.model.js';
import type { TurnAttachment } from '../models/turn-attachment.model.js';
import type { QuestionSubmission } from '../models/user-question.model.js';
import { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';
import { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';
import { UserQuestionQueueService } from '../services/user-question-queue.service.js';

import { StartAgentConfigSelectionUseCase } from './start-agent-config-selection.use-case.js';
import { SubmitAgentConfigSelectionUseCase } from './submit-agent-config-selection.use-case.js';


const ATTACHMENTS_ONLY_PROMPT = 'O usuário enviou anexos. Analise os arquivos anexados.';

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
  ) {}

  async execute(input: ResolveConversationInputInput): Promise<ConversationInputResolution> {
    const { conversationId, attachments } = input;

    const submission = this.questionQueue.submit(conversationId, { text: input.prompt, attachments });
    if (submission) {
      return this.describeSubmission(submission);
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

  private describeSubmission(submission: QuestionSubmission): ConversationInputResolution {
    if (submission.kind === 'answered') {
      return submission;
    }
    return { kind: submission.kind === 'next' ? 'question' : 'invalid_answer', prompt: submission.prompt };
  }
}
