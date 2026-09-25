import { Inject, Injectable } from '@nestjs/common';

import type { ConversationInputResolution } from '../models/agent-config-outcome.model.js';
import { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';
import { IAgentSettingsStorePort } from '../ports/agent-settings-store.port.js';

import { StartAgentConfigSelectionUseCase } from './start-agent-config-selection.use-case.js';
import { SubmitAgentConfigSelectionUseCase } from './submit-agent-config-selection.use-case.js';


export type ResolveConversationInputInput = {
  readonly channelId: string;
  readonly threadId?: string;
  readonly prompt: string;
};

@Injectable()
export class ResolveConversationInputUseCase {
  constructor(
    @Inject(IAgentConfigSelectionStorePort)
    private readonly selectionStore: IAgentConfigSelectionStorePort,
    @Inject(IAgentSettingsStorePort)
    private readonly settingsStore: IAgentSettingsStorePort,
    private readonly startSelection: StartAgentConfigSelectionUseCase,
    private readonly submitSelection: SubmitAgentConfigSelectionUseCase,
  ) {}

  async execute(input: ResolveConversationInputInput): Promise<ConversationInputResolution> {
    const { channelId, threadId, prompt } = input;

    if (await this.selectionStore.find(channelId, threadId)) {
      const outcome = await this.submitSelection.execute({ channelId, threadId, input: prompt });
      if (outcome.kind !== 'configured') {
        return outcome;
      }
      if (outcome.pendingPrompt) {
        return { kind: 'execute', prompt: outcome.pendingPrompt, configured: outcome.settings };
      }
      return { kind: 'configured', settings: outcome.settings };
    }

    if (await this.settingsStore.load()) {
      return { kind: 'execute', prompt };
    }

    const started = await this.startSelection.execute({ channelId, threadId, pendingPrompt: prompt });
    if (started.kind === 'unavailable') {
      return { kind: 'execute', prompt };
    }
    return started;
  }
}
