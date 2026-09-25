import { Inject, Injectable } from '@nestjs/common';

import type { StartAgentConfigSelectionResult } from '../models/agent-config-outcome.model.js';
import type { AgentConfigSelection } from '../models/agent-config-selection.model.js';
import { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';
import { AgentCapabilitiesService } from '../services/agent-capabilities.service.js';


export type StartAgentConfigSelectionInput = {
  readonly channelId: string;
  readonly threadId?: string;
  readonly pendingPrompt?: string;
};

@Injectable()
export class StartAgentConfigSelectionUseCase {
  constructor(
    private readonly capabilities: AgentCapabilitiesService,
    @Inject(IAgentConfigSelectionStorePort)
    private readonly selectionStore: IAgentConfigSelectionStorePort,
  ) {}

  async execute(input: StartAgentConfigSelectionInput): Promise<StartAgentConfigSelectionResult> {
    const models = await this.capabilities.listModels();
    if (!models || models.availableModels.length === 0) {
      return { kind: 'unavailable' };
    }

    const selection: AgentConfigSelection = {
      channelId: input.channelId,
      threadId: input.threadId,
      step: 'model',
      options: models.availableModels.map((model, position) => ({
        index: position + 1,
        id: model.modelId,
        label: model.displayName,
        description: model.description,
      })),
      pendingPrompt: input.pendingPrompt,
    };
    await this.selectionStore.save(selection);
    return { kind: 'selection', selection };
  }
}
