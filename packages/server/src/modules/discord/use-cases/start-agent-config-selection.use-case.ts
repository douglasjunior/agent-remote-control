import { Inject, Injectable } from '@nestjs/common';

import type { SquadView } from '../../orchestrator/models/squad.model.js';
import { IAgentConfigurationPort } from '../../orchestrator/ports/agent-configuration.port.js';
import type { StartAgentConfigSelectionResult } from '../models/agent-config-outcome.model.js';
import type {
  AgentConfigSelection,
  SelectedValue,
} from '../models/agent-config-selection.model.js';
import type { PendingMessage } from '../models/pending-message.model.js';
import { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';
import { AgentProfileListService } from '../services/agent-profile-list.service.js';
import { toSelectionOptions } from '../utils/selection-options.util.js';


const DEFAULT_SQUAD_SUFFIX = ' (default)';

export type StartAgentConfigSelectionInput = {
  readonly conversationId: string;
  readonly pendingMessage?: PendingMessage;
  readonly step: 'profile' | 'agent' | 'model' | 'squad';
};

@Injectable()
export class StartAgentConfigSelectionUseCase {
  constructor(
    @Inject(IAgentConfigurationPort)
    private readonly configuration: IAgentConfigurationPort,
    @Inject(IAgentConfigSelectionStorePort)
    private readonly selectionStore: IAgentConfigSelectionStorePort,
    private readonly profileList: AgentProfileListService,
  ) {}

  async execute(input: StartAgentConfigSelectionInput): Promise<StartAgentConfigSelectionResult> {
    if (input.step === 'profile') {
      if (this.configuration.listAgents().length === 0) {
        return { kind: 'unavailable' };
      }
      return { kind: 'profiles_menu', selection: await this.profileList.open(input.conversationId) };
    }

    if (input.step === 'squad') {
      return this.startSquadStep(input.conversationId);
    }

    if (input.step === 'model') {
      return this.startModelStep(input, await this.configuration.currentAgent(input.conversationId));
    }

    const agents = toSelectionOptions(this.configuration.listAgents());
    if (agents.length === 0) {
      return { kind: 'unavailable' };
    }
    if (agents.length === 1) {
      return this.startModelStep(input, { id: agents[0]!.id, name: agents[0]!.label });
    }

    return this.save({
      conversationId: input.conversationId,
      step: 'agent',
      options: agents,
      pendingMessage: input.pendingMessage,
    });
  }

  private async startModelStep(
    input: StartAgentConfigSelectionInput,
    agent: SelectedValue,
  ): Promise<StartAgentConfigSelectionResult> {
    const models = toSelectionOptions(await this.configuration.listModels(agent.id));
    if (models.length === 0) {
      return { kind: 'unavailable' };
    }

    return this.save({
      conversationId: input.conversationId,
      step: 'model',
      options: models,
      selectedAgent: agent,
      pendingMessage: input.pendingMessage,
    });
  }

  private async startSquadStep(conversationId: string): Promise<StartAgentConfigSelectionResult> {
    const squads = await this.configuration.listSquads();
    if (squads.length === 0) {
      return { kind: 'unavailable' };
    }
    return this.save({
      conversationId,
      step: 'squad',
      options: squads.map((squad, position) => ({
        index: position + 1,
        id: squad.id,
        label: squad.name,
        description: `${squad.description ?? this.describeRoles(squad)}${squad.isDefault ? DEFAULT_SQUAD_SUFFIX : ''}`,
      })),
    });
  }

  /** How many roles the squad sets and the agents they run on. */
  private describeRoles(squad: SquadView): string {
    const agents = [...new Set(squad.profiles.flatMap(({ profile }) => (profile ? [profile.agentName] : [])))];
    const roles = squad.profiles.length === 1 ? '1 role' : `${squad.profiles.length} roles`;
    return [roles, ...agents.length > 0 ? [agents.join(', ')] : []].join(' · ');
  }

  private async save(selection: AgentConfigSelection): Promise<StartAgentConfigSelectionResult> {
    await this.selectionStore.save(selection);
    return { kind: 'selection', selection };
  }
}
