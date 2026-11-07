import type { RoleProfile } from '@agent-remote-control/protocol/agent-profile';
import type { ConversationState, ConversationSummary } from '@agent-remote-control/protocol/conversation';
import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';

import type { InterruptedWork } from '../../orchestrator/models/open-work.model.js';
import { IConversationStorePort } from '../ports/conversation-store.port.js';

import { ConversationEntryService } from './conversation-entry.service.js';
import { WebConnectionRegistryService } from './web-connection-registry.service.js';


type QuestionEntry = Extract<ConversationEntry, { type: 'question' }>;

@Injectable()
export class WebConversationEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(WebConversationEventsService.name);
  private readonly states = new Map<string, ConversationState>();
  private readonly drafts = new Map<string, string>();
  private readonly openQuestions = new Map<string, Map<string, QuestionEntry>>();
  private frozen = false;

  constructor(
    @Inject(IConversationStorePort) private readonly store: IConversationStorePort,
    private readonly registry: WebConnectionRegistryService,
    private readonly entries: ConversationEntryService,
  ) {}

  /** Shutting down stops the turns: what they report on the way out is not what happened to the conversation. */
  onModuleDestroy(): void {
    this.frozen = true;
  }

  /**
   * Broadcasts first so the order of the stream does not depend on the store. An entry that delivers the
   * response being written replaces its draft.
   */
  async publishEntry(conversationId: string, entry: ConversationEntry): Promise<void> {
    if (this.frozen) {
      return;
    }
    if (this.deliversResponse(entry)) {
      this.publishDraft(conversationId, '');
    }
    this.trackQuestion(conversationId, entry);
    this.registry.broadcast({ type: 'conversation.entry', conversationId, entry });
    try {
      await this.store.upsertEntry(conversationId, entry);
    } catch (error) {
      this.logger.error(`entry_not_persisted: ${conversationId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Closes, in place, every question of the conversation that is still open. */
  async closeOpenQuestions(conversationId: string): Promise<void> {
    const open = [...this.openQuestions.get(conversationId)?.values() ?? []];
    await Promise.all(open.map(question => this.publishEntry(conversationId, { ...question, closed: true })));
  }

  /**
   * Settles the questions an earlier server process left open in the history. The one the queue restored stays open
   * and is tracked again; the others have nothing waiting for them and are closed.
   */
  async settleOrphanedQuestions(conversationId: string, isRestored: (question: QuestionEntry) => boolean): Promise<void> {
    for (const entry of await this.store.history(conversationId)) {
      if (entry.type === 'question' && !entry.closed && isRestored(entry)) {
        this.trackQuestion(conversationId, entry);
      }
    }
    const tracked = this.openQuestions.get(conversationId);
    await this.abandonQuestions(conversationId, question => !tracked?.has(question.id));
  }

  hasOpenQuestion(conversationId: string): boolean {
    return (this.openQuestions.get(conversationId)?.size ?? 0) > 0;
  }

  /** Closes every open question of a conversation whose agents are not waiting for an answer. */
  closeUnanswerableQuestions(conversationId: string): Promise<void> {
    return this.abandonQuestions(conversationId, () => true);
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

  publishInterrupted(conversationId: string, interrupted: readonly InterruptedWork[]): void {
    this.registry.broadcast({ type: 'conversation.interrupted', conversationId, interrupted: [...interrupted] });
  }

  publishConversation(conversation: ConversationSummary, exceptConnectionId?: string): void {
    this.registry.broadcast({ type: 'conversation.updated', conversation }, exceptConnectionId);
  }

  private async abandonQuestions(conversationId: string, isAbandoned: (question: QuestionEntry) => boolean): Promise<void> {
    const abandoned = (await this.store.history(conversationId)).filter(
      (entry): entry is QuestionEntry => entry.type === 'question' && !entry.closed && isAbandoned(entry),
    );
    const last = abandoned.at(-1);
    if (!last) {
      return;
    }
    await Promise.all(abandoned.map(question => this.publishEntry(conversationId, { ...question, closed: true })));
    await this.publishEntry(conversationId, this.entries.abandonedQuestionNotice(last.id));
  }

  private trackQuestion(conversationId: string, entry: ConversationEntry): void {
    if (entry.type !== 'question') {
      return;
    }
    const open = this.openQuestions.get(conversationId) ?? new Map<string, QuestionEntry>();
    if (entry.closed) {
      open.delete(entry.id);
    } else {
      open.set(entry.id, entry);
    }
    this.openQuestions.set(conversationId, open);
  }

  /** A steered prompt is absorbed by the running turn, whose response is still being written. */
  private deliversResponse(entry: ConversationEntry): boolean {
    return entry.type === 'interim'
      || (entry.type === 'question' && !entry.closed)
      || (entry.type === 'agent_response' && entry.status !== 'steered');
  }
}
