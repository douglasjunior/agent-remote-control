import { Inject, Injectable } from '@nestjs/common';

import { IAgentAuthPort } from '../../agent/ports/agent-auth.port.js';
import { IAgentConfigurationPort } from '../../orchestrator/ports/agent-configuration.port.js';
import type { AgentAuthChoice } from '../models/agent-auth-choice.model.js';
import type {
  ConversationInputResolution,
  StartAgentAuthSelectionResult,
  StartAgentConfigSelectionResult,
} from '../models/agent-config-outcome.model.js';
import { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';
import { CancelAgentConfigSelectionUseCase } from '../use-cases/cancel-agent-config-selection.use-case.js';
import {
  type ResolveConversationInputInput,
  ResolveConversationInputUseCase,
} from '../use-cases/resolve-conversation-input.use-case.js';
import { StartAgentConfigSelectionUseCase } from '../use-cases/start-agent-config-selection.use-case.js';

import { AgentAuthRequestService } from './agent-auth-request.service.js';
import { type AuthMessageChannel, DiscordAgentAuthNotifierService } from './discord-agent-auth-notifier.service.js';
import { LanguageChangeRequestService } from './language-change-request.service.js';


/** The conversation state Discord keeps for its numbered dialogs: open menus, pending language requests and agent logins. */
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
    @Inject(IAgentAuthPort)
    private readonly agentAuth: IAgentAuthPort,
    private readonly agentAuthRequests: AgentAuthRequestService,
    private readonly agentAuthNotifier: DiscordAgentAuthNotifierService,
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

  /** Lists the agents with a CLI login; the next message in the conversation picks one by number. */
  async startAgentAuthSelection(conversationId: string): Promise<StartAgentAuthSelectionResult> {
    const infos = await this.agentAuth.listAuthInfo();
    if (infos.length === 0) {
      return { kind: 'unavailable' };
    }
    const entries = infos.map((info, position) => ({ ...info, index: position + 1 }));
    this.agentAuthRequests.requestPick(conversationId, entries.map(({ agentId, displayName }) => ({ agentId, displayName })));
    return { kind: 'menu', entries };
  }

  startAgentLogin(conversationId: string, agent: AgentAuthChoice, channel: AuthMessageChannel): Promise<void> {
    return this.agentAuthNotifier.start(conversationId, agent, channel);
  }

  /** Whether a message in the conversation answers the login dialog: the agent pick or the pasted code. */
  hasPendingAgentAuth(conversationId: string): boolean {
    return this.agentAuthRequests.pendingPick(conversationId) !== undefined
      || this.agentAuthRequests.loginAwaitingCode(conversationId) !== undefined;
  }

  /** Cancels a pending pick and a running login; returns whether there was one. */
  cancelAgentAuth(conversationId: string): boolean {
    const pickCancelled = this.agentAuthRequests.cancelPick(conversationId);
    return this.agentAuthNotifier.cancel(conversationId) || pickCancelled;
  }
}
