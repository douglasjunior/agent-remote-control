import { Inject, Injectable } from '@nestjs/common';

import type { StartAgentConfigSelectionResult } from '../models/agent-config-outcome.model.js';
import type {
  AgentConfigSelection,
  SelectedValue,
} from '../models/agent-config-selection.model.js';
import { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';
import { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';
import { AgentCapabilitiesService } from '../services/agent-capabilities.service.js';


export type StartAgentConfigSelectionInput = {
  readonly channelId: string;
  readonly threadId?: string;
  readonly pendingPrompt?: string;
  readonly step: 'agent' | 'model';
};

@Injectable()
export class StartAgentConfigSelectionUseCase {
  constructor(
    private readonly capabilities: AgentCapabilitiesService,
    @Inject(IAgentConfigSelectionStorePort)
    private readonly selectionStore: IAgentConfigSelectionStorePort,
    @Inject(IAgentSettingsStorePort)
    private readonly settingsStore: IAgentSettingsStorePort,
  ) {}

  async execute(input: StartAgentConfigSelectionInput): Promise<StartAgentConfigSelectionResult> {
    if (input.step === 'model') {
      return this.startModelStep(input, this.capabilities.resolveAgent(await this.settingsStore.load()));
    }

    const agents = this.capabilities.listAgentOptions();
    if (agents.length === 0) {
      return { kind: 'unavailable' };
    }
    if (agents.length === 1) {
      return this.startModelStep(input, { id: agents[0]!.id, name: agents[0]!.label });
    }

    return this.save({
      channelId: input.channelId,
      threadId: input.threadId,
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
      channelId: input.channelId,
      threadId: input.threadId,
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
