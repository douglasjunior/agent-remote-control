import { Inject, Injectable } from '@nestjs/common';

import type { AgentConfigSelectionOutcome } from '../models/agent-config-outcome.model.js';
import type {
  AgentConfigSelection,
  SelectedValue,
  SelectionOption,
} from '../models/agent-config-selection.model.js';
import type { AgentSettings } from '../models/agent-settings.model.js';
import { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';
import { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';
import { AgentCapabilitiesService } from '../services/agent-capabilities.service.js';


const OPTION_NUMBER_PATTERN = /^\d+$/;

export type SubmitAgentConfigSelectionInput = {
  readonly channelId: string;
  readonly threadId?: string;
  readonly input: string;
};

@Injectable()
export class SubmitAgentConfigSelectionUseCase {
  constructor(
    private readonly capabilities: AgentCapabilitiesService,
    @Inject(IAgentConfigSelectionStorePort)
    private readonly selectionStore: IAgentConfigSelectionStorePort,
    @Inject(IAgentSettingsStorePort)
    private readonly settingsStore: IAgentSettingsStorePort,
  ) {}

  async execute(input: SubmitAgentConfigSelectionInput): Promise<AgentConfigSelectionOutcome> {
    const selection = await this.selectionStore.find(input.channelId, input.threadId);
    if (!selection) {
      throw new Error('No agent configuration selection in progress.');
    }

    const option = this.pickOption(selection, input.input);
    if (!option) {
      return { kind: 'invalid', selection };
    }

    if (selection.step === 'agent') {
      return this.submitAgent(selection, { id: option.id, name: option.label });
    }

    const agent = selection.selectedAgent;
    if (!agent) {
      throw new Error(`Agent configuration selection at step "${selection.step}" has no agent.`);
    }

    if (selection.selectedModel) {
      return this.configure(selection, agent, selection.selectedModel, option);
    }

    return this.submitModel(selection, agent, { id: option.id, name: option.label });
  }

  private async submitAgent(
    selection: AgentConfigSelection,
    agent: SelectedValue,
  ): Promise<AgentConfigSelectionOutcome> {
    const models = await this.capabilities.listModelOptions(agent.id);
    if (models.length === 0) {
      return this.configure(selection, agent, null, null);
    }

    return this.advance({ ...selection, step: 'model', selectedAgent: agent, options: models });
  }

  private async submitModel(
    selection: AgentConfigSelection,
    agent: SelectedValue,
    model: SelectedValue,
  ): Promise<AgentConfigSelectionOutcome> {
    const efforts = await this.capabilities.listEffortOptions(agent.id, model.id);
    if (efforts.length === 0) {
      return this.configure(selection, agent, model, null);
    }

    return this.advance({ ...selection, step: 'effort', selectedModel: model, options: efforts });
  }

  private async advance(selection: AgentConfigSelection): Promise<AgentConfigSelectionOutcome> {
    await this.selectionStore.save(selection);
    return { kind: 'selection', selection };
  }

  private pickOption(selection: AgentConfigSelection, input: string): SelectionOption | null {
    const trimmed = input.trim();
    if (!OPTION_NUMBER_PATTERN.test(trimmed)) {
      return null;
    }
    const index = Number(trimmed);
    return selection.options.find(option => option.index === index) ?? null;
  }

  private async configure(
    selection: AgentConfigSelection,
    agent: SelectedValue,
    model: SelectedValue | null,
    effort: SelectionOption | null,
  ): Promise<AgentConfigSelectionOutcome> {
    const settings: AgentSettings = {
      agentId: agent.id,
      agentName: agent.name,
      modelId: model?.id ?? null,
      modelName: model?.name ?? null,
      effortId: effort?.id ?? null,
      effortName: effort?.label ?? null,
      updatedAt: new Date().toISOString(),
    };
    await this.settingsStore.save(settings);
    await this.selectionStore.remove(selection.channelId, selection.threadId);
    return { kind: 'configured', settings, pendingPrompt: selection.pendingPrompt };
  }
}
