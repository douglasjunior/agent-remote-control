import { Inject, Injectable } from '@nestjs/common';

import { IAgentConfigurationPort } from '../../orchestrator/ports/agent-configuration.port.js';
import type { StartAgentConfigSelectionResult } from '../models/agent-config-outcome.model.js';
import type {
  AgentConfigSelection,
  SelectedValue,
} from '../models/agent-config-selection.model.js';
import { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';
import { AgentProfileListService } from '../services/agent-profile-list.service.js';
import { toSelectionOptions } from '../utils/selection-options.util.js';


export type StartAgentConfigSelectionInput = {
  readonly conversationId: string;
  readonly pendingPrompt?: string;
  readonly step: 'profile' | 'agent' | 'model';
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
      pendingPrompt: input.pendingPrompt,
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
      pendingPrompt: input.pendingPrompt,
    });
  }

  private async save(selection: AgentConfigSelection): Promise<StartAgentConfigSelectionResult> {
    await this.selectionStore.save(selection);
    return { kind: 'selection', selection };
  }
}
