import { Injectable } from '@nestjs/common';

import type { AgentConfigSelection } from '../models/agent-config-selection.model.js';
import type { IAgentConfigSelectionStorePort } from '../ports/agent-config-selection-store.port.js';


@Injectable()
export class InMemoryAgentConfigSelectionStoreAdapter implements IAgentConfigSelectionStorePort {
  private readonly selections = new Map<string, AgentConfigSelection>();

  async find(conversationId: string): Promise<AgentConfigSelection | null> {
    return this.selections.get(conversationId) ?? null;
  }

  async save(selection: AgentConfigSelection): Promise<void> {
    this.selections.set(selection.conversationId, selection);
  }

  async remove(conversationId: string): Promise<boolean> {
    return this.selections.delete(conversationId);
  }
}
