import { Inject, Injectable } from '@nestjs/common';

import type { AgentConfigSelectionOutcome } from '../models/agent-config-outcome.model.js';
import type {
  AgentConfigSelection,
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

    if (selection.selectedModel) {
      return this.configure(selection, selection.selectedModel, option);
    }

    const selectedModel = { id: option.id, name: option.label };
    const efforts = await this.capabilities.listEfforts(option.id);
    if (!efforts || efforts.availableEfforts.length === 0) {
      return this.configure(selection, selectedModel, null);
    }

    const effortSelection: AgentConfigSelection = {
      ...selection,
      step: 'effort',
      selectedModel,
      options: efforts.availableEfforts.map((effort, position) => ({
        index: position + 1,
        id: effort.effortId,
        label: effort.name,
        description: effort.description,
      })),
    };
    await this.selectionStore.save(effortSelection);
    return { kind: 'selection', selection: effortSelection };
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
    model: { readonly id: string; readonly name: string },
    effort: SelectionOption | null,
  ): Promise<AgentConfigSelectionOutcome> {
    const settings: AgentSettings = {
      modelId: model.id,
      modelName: model.name,
      effortId: effort?.id ?? null,
      effortName: effort?.label ?? null,
      updatedAt: new Date().toISOString(),
    };
    await this.settingsStore.save(settings);
    await this.selectionStore.remove(selection.channelId, selection.threadId);
    return { kind: 'configured', settings, pendingPrompt: selection.pendingPrompt };
  }
}
