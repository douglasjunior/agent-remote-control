import { Inject, Injectable } from '@nestjs/common';

import type {
  ConversationInputResolution,
  StartAgentConfigSelectionResult,
} from '../models/agent-config-outcome.model.js';
import type { AgentQuotaReport } from '../models/agent-quota-report.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { TurnResult } from '../models/turn-result.model.js';
import { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';
import { IPreferencesStorePort } from '../ports/preferences-store.port.js';
import { DEFAULT_USER_LANGUAGE } from '../prompts/user-language.prompt.js';
import { CancelAgentConfigSelectionUseCase } from '../use-cases/cancel-agent-config-selection.use-case.js';
import { CancelAgentTurnUseCase } from '../use-cases/cancel-agent-turn.use-case.js';
import { ExecuteAgentTurnUseCase } from '../use-cases/execute-agent-turn.use-case.js';
import { GetAgentQuotaUseCase } from '../use-cases/get-agent-quota.use-case.js';
import {
  type ResolveConversationInputInput,
  ResolveConversationInputUseCase,
} from '../use-cases/resolve-conversation-input.use-case.js';
import { StartAgentConfigSelectionUseCase } from '../use-cases/start-agent-config-selection.use-case.js';

import { LanguageChangeRequestService } from './language-change-request.service.js';
import { UserQuestionQueueService } from './user-question-queue.service.js';


@Injectable()
export class OrchestratorService {
  constructor(
    private readonly executeAgentTurnUseCase: ExecuteAgentTurnUseCase,
    private readonly cancelAgentTurnUseCase: CancelAgentTurnUseCase,
    private readonly resolveConversationInputUseCase: ResolveConversationInputUseCase,
    private readonly startAgentConfigSelectionUseCase: StartAgentConfigSelectionUseCase,
    private readonly cancelAgentConfigSelectionUseCase: CancelAgentConfigSelectionUseCase,
    @Inject(IAgentConfigSelectionStorePort)
    private readonly selectionStore: IAgentConfigSelectionStorePort,
    private readonly getAgentQuotaUseCase: GetAgentQuotaUseCase,
    private readonly questionQueue: UserQuestionQueueService,
    private readonly languageChangeRequests: LanguageChangeRequestService,
    @Inject(IPreferencesStorePort)
    private readonly preferencesStore: IPreferencesStorePort,
  ) {}

  async executeTurn(request: TurnRequest): Promise<TurnResult> {
    return this.executeAgentTurnUseCase.execute(request);
  }

  async cancelTurn(conversationId: string): Promise<boolean> {
    return this.cancelAgentTurnUseCase.execute(conversationId);
  }

  getQuota(): Promise<readonly AgentQuotaReport[]> {
    return this.getAgentQuotaUseCase.execute();
  }

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

  hasPendingQuestions(conversationId: string): boolean {
    return this.questionQueue.hasPending(conversationId);
  }

  /** The next message in the conversation sets the language; resolves to the current one. */
  async requestLanguageChange(conversationId: string): Promise<string> {
    this.languageChangeRequests.request(conversationId);
    return (await this.preferencesStore.load()).language ?? DEFAULT_USER_LANGUAGE;
  }

  hasPendingLanguageChange(conversationId: string): boolean {
    return this.languageChangeRequests.isPending(conversationId);
  }

  cancelLanguageChange(conversationId: string): boolean {
    return this.languageChangeRequests.cancel(conversationId);
  }
}
