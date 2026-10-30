import { Inject, Injectable } from '@nestjs/common';

import type { StartAgentConfigSelectionResult } from '../models/agent-config-outcome.model.js';
import type {
  AgentConfigSelection,
  SelectedValue,
} from '../models/agent-config-selection.model.js';
import { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';
import { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';
import { AgentCapabilitiesService } from '../services/agent-capabilities.service.js';
import { AgentProfileListService } from '../services/agent-profile-list.service.js';


export type StartAgentConfigSelectionInput = {
  readonly conversationId: string;
  readonly pendingPrompt?: string;
  readonly step: 'profile' | 'agent' | 'model';
};

@Injectable()
export class StartAgentConfigSelectionUseCase {
  constructor(
    private readonly capabilities: AgentCapabilitiesService,
    @Inject(IAgentConfigSelectionStorePort)
    private readonly selectionStore: IAgentConfigSelectionStorePort,
    @Inject(IAgentSettingsStorePort)
    private readonly settingsStore: IAgentSettingsStorePort,
    private readonly profileList: AgentProfileListService,
  ) {}

  async execute(input: StartAgentConfigSelectionInput): Promise<StartAgentConfigSelectionResult> {
    if (input.step === 'profile') {
      if (this.capabilities.listAgentOptions().length === 0) {
        return { kind: 'unavailable' };
      }
      return { kind: 'profiles_menu', selection: await this.profileList.open(input.conversationId) };
    }

    if (input.step === 'model') {
      const currentOrRecent = (await this.settingsStore.load(input.conversationId))
        ?? (await this.settingsStore.loadMostRecent());
      return this.startModelStep(input, this.capabilities.resolveAgent(currentOrRecent));
    }

    const agents = this.capabilities.listAgentOptions();
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
    const models = await this.capabilities.listModelOptions(agent.id);
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
