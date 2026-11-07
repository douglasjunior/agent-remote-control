import { Inject, Injectable } from '@nestjs/common';

import { IAgentConfigurationPort } from '../../orchestrator/ports/agent-configuration.port.js';
import type {
  ConversationInputResolution,
  StartAgentConfigSelectionResult,
} from '../models/agent-config-outcome.model.js';
import { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';
import { CancelAgentConfigSelectionUseCase } from '../use-cases/cancel-agent-config-selection.use-case.js';
import {
  type ResolveConversationInputInput,
  ResolveConversationInputUseCase,
} from '../use-cases/resolve-conversation-input.use-case.js';
import { StartAgentConfigSelectionUseCase } from '../use-cases/start-agent-config-selection.use-case.js';

import { LanguageChangeRequestService } from './language-change-request.service.js';


/** The conversation state Discord keeps for its numbered dialogs: open menus and pending language requests. */
@Injectable()
export class DiscordConversationService {
  constructor(
    private readonly resolveConversationInputUseCase: ResolveConversationInputUseCase,
    private readonly startAgentConfigSelectionUseCase: StartAgentConfigSelectionUseCase,
    private readonly cancelAgentConfigSelectionUseCase: CancelAgentConfigSelectionUseCase,
    @Inject(IAgentConfigSelectionStorePort)
    private readonly selectionStore: IAgentConfigSelectionStorePort,
    private readonly languageChangeRequests: LanguageChangeRequestService,
    @Inject(IAgentConfigurationPort)
    private readonly configuration: IAgentConfigurationPort,
  ) {}

  resolveInput(input: ResolveConversationInputInput): Promise<ConversationInputResolution> {
    return this.resolveConversationInputUseCase.execute(input);
  }

  startConfigSelection(conversationId: string): Promise<StartAgentConfigSelectionResult> {
    return this.startAgentConfigSelectionUseCase.execute({ conversationId, step: 'model' });
  }

  startAgentSelection(conversationId: string): Promise<StartAgentConfigSelectionResult> {
    return this.startAgentConfigSelectionUseCase.execute({ conversationId, step: 'agent' });
  }

  startProfilesSelection(conversationId: string): Promise<StartAgentConfigSelectionResult> {
    return this.startAgentConfigSelectionUseCase.execute({ conversationId, step: 'profile' });
  }

  cancelConfigSelection(conversationId: string): Promise<boolean> {
    return this.cancelAgentConfigSelectionUseCase.execute(conversationId);
  }

  async hasActiveConfigSelection(conversationId: string): Promise<boolean> {
    return (await this.selectionStore.find(conversationId)) !== null;
  }

  /** The next message in the conversation sets the language; resolves to the current one. */
  async requestLanguageChange(conversationId: string): Promise<string> {
    this.languageChangeRequests.request(conversationId);
    return this.configuration.getLanguage();
  }

  hasPendingLanguageChange(conversationId: string): boolean {
    return this.languageChangeRequests.isPending(conversationId);
  }

  cancelLanguageChange(conversationId: string): boolean {
    return this.languageChangeRequests.cancel(conversationId);
  }
}
