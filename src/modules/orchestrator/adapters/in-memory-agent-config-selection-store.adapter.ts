import { Injectable } from '@nestjs/common';

import type { AgentConfigSelection } from '../models/agent-config-selection.model.js';
import type { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';


@Injectable()
export class InMemoryAgentConfigSelectionStoreAdapter implements IAgentConfigSelectionStorePort {
  private readonly selections = new Map<string, AgentConfigSelection>();

  async find(channelId: string, threadId?: string): Promise<AgentConfigSelection | null> {
    return this.selections.get(this.key(channelId, threadId)) ?? null;
  }

  async save(selection: AgentConfigSelection): Promise<void> {
    this.selections.set(this.key(selection.channelId, selection.threadId), selection);
  }

  async remove(channelId: string, threadId?: string): Promise<boolean> {
    return this.selections.delete(this.key(channelId, threadId));
  }

  private key(channelId: string, threadId?: string): string {
    return `${channelId}:${threadId ?? ''}`;
  }
}
