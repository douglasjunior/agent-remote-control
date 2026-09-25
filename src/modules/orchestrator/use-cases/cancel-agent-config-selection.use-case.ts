import { Inject, Injectable } from '@nestjs/common';

import { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';


@Injectable()
export class CancelAgentConfigSelectionUseCase {
  constructor(
    @Inject(IAgentConfigSelectionStorePort)
    private readonly selectionStore: IAgentConfigSelectionStorePort,
  ) {}

  execute(channelId: string, threadId?: string): Promise<boolean> {
    return this.selectionStore.remove(channelId, threadId);
  }
}
