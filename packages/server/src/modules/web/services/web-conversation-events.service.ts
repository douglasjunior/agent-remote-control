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
  private readonly drafts = new Map<string, string>();

  constructor(
    @Inject(IConversationStorePort) private readonly store: IConversationStorePort,
    private readonly registry: WebConnectionRegistryService,
  ) {}

  /**
   * Broadcasts first so the order of the stream does not depend on the store. An entry that delivers the
   * response being written replaces its draft.
   */
  async publishEntry(conversationId: string, entry: ConversationEntry): Promise<void> {
    if (this.deliversResponse(entry)) {
      this.publishDraft(conversationId, '');
    }
    this.registry.broadcast({ type: 'conversation.entry', conversationId, entry });
    try {
      await this.store.upsertEntry(conversationId, entry);
    } catch (error) {
      this.logger.error(`entry_not_persisted: ${conversationId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** A draft is kept in memory only: the entry that delivers the finished response is what the history stores. */
  publishDraft(conversationId: string, text: string): void {
    if (this.draftOf(conversationId) === text) {
      return;
    }
    if (text === '') {
      this.drafts.delete(conversationId);
    } else {
      this.drafts.set(conversationId, text);
    }
    this.registry.broadcast({ type: 'conversation.draft', conversationId, text });
  }

  draftOf(conversationId: string): string {
    return this.drafts.get(conversationId) ?? '';
  }

  /** An idle conversation has nothing being written, whatever way the turn ended. */
  publishState(conversationId: string, state: ConversationState): void {
    if (state === 'idle') {
      this.publishDraft(conversationId, '');
    }
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

  /** A steered prompt is absorbed by the running turn, whose response is still being written. */
  private deliversResponse(entry: ConversationEntry): boolean {
    return entry.type === 'interim'
      || entry.type === 'question'
      || (entry.type === 'agent_response' && entry.status !== 'steered');
  }
}
