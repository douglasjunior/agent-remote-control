import type { RoleProfile } from '@agent-remote-control/protocol/agent-profile';
import type { ConversationState, ConversationSummary } from '@agent-remote-control/protocol/conversation';
import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { IConversationStorePort } from '../ports/conversation-store.port.js';

import { WebConnectionRegistryService } from './web-connection-registry.service.js';


@Injectable()
export class WebConversationEventsService {
  private readonly logger = new Logger(WebConversationEventsService.name);
  private readonly states = new Map<string, ConversationState>();

  constructor(
    @Inject(IConversationStorePort) private readonly store: IConversationStorePort,
    private readonly registry: WebConnectionRegistryService,
  ) {}

  /** Broadcasts first so the order of the stream does not depend on the store. */
  async publishEntry(conversationId: string, entry: ConversationEntry): Promise<void> {
    this.registry.broadcast({ type: 'conversation.entry', conversationId, entry });
    try {
      await this.store.upsertEntry(conversationId, entry);
    } catch (error) {
      this.logger.error(`entry_not_persisted: ${conversationId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  publishState(conversationId: string, state: ConversationState): void {
    this.states.set(conversationId, state);
    this.registry.broadcast({ type: 'conversation.state', conversationId, state });
  }

  stateOf(conversationId: string): ConversationState {
    return this.states.get(conversationId) ?? 'idle';
  }

  publishProfiles(conversationId: string, configured: boolean, profiles: readonly RoleProfile[]): void {
    this.registry.broadcast({ type: 'profiles', conversationId, configured, profiles: [...profiles] });
  }

  publishConversation(conversation: ConversationSummary, exceptConnectionId?: string): void {
    this.registry.broadcast({ type: 'conversation.updated', conversation }, exceptConnectionId);
  }
}
