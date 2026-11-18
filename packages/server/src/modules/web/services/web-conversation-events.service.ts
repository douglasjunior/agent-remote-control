import type { RoleProfile } from '@agent-remote-control/protocol/agent-profile';
import type { ConversationState, ConversationSummary } from '@agent-remote-control/protocol/conversation';
import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';

import type { InterruptedWork } from '../../orchestrator/models/open-work.model.js';
import { IConversationStorePort } from '../ports/conversation-store.port.js';

import { ConversationEntryService } from './conversation-entry.service.js';
import { WebConnectionRegistryService } from './web-connection-registry.service.js';


type QuestionEntry = Extract<ConversationEntry, { type: 'question' }>;
type RetryEntry = Extract<ConversationEntry, { type: 'retry' }>;

@Injectable()
export class WebConversationEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(WebConversationEventsService.name);
  private readonly states = new Map<string, ConversationState>();
  private readonly drafts = new Map<string, string>();
  private readonly openQuestions = new Map<string, Map<string, QuestionEntry>>();
  private readonly openRetries = new Map<string, Map<string, RetryEntry>>();
  private readonly liveDelegations = new Map<string, Set<string>>();
  private readonly publishing = new Map<string, Promise<void>>();
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
   * Places the entry in the history, then broadcasts it with its position, one entry of a conversation at a time
   * so the stream follows the order of the history. An entry that delivers the response being written replaces
   * its draft. An entry the store refuses reaches no client, since no history would show it again.
   */
  publishEntry(conversationId: string, entry: ConversationEntry): Promise<void> {
    if (this.frozen) {
      return Promise.resolve();
    }
    this.trackQuestion(conversationId, entry);
    this.trackRetry(conversationId, entry);
    this.trackDelegation(conversationId, entry);
    const published = (this.publishing.get(conversationId) ?? Promise.resolve()).then(() => this.place(conversationId, entry));
    this.publishing.set(conversationId, published);
    void published.then(() => {
      if (this.publishing.get(conversationId) === published) {
        this.publishing.delete(conversationId);
      }
    });
    return published;
  }

  /** Closes, in place, every question of the conversation that is still open. */
  async closeOpenQuestions(conversationId: string): Promise<void> {
    const open = [...this.openQuestions.get(conversationId)?.values() ?? []];
    await Promise.all(open.map(question => this.publishEntry(conversationId, { ...question, closed: true })));
  }

  /** Closes, in place, every retry of the conversation that is still shown as waiting. */
  async closeOpenRetries(conversationId: string): Promise<void> {
    const open = [...this.openRetries.get(conversationId)?.values() ?? []];
    await Promise.all(open.map(retry => this.publishEntry(conversationId, { ...retry, closed: true })));
  }

  /** Closes the retries the history shows as waiting although this process has none: an earlier process left them open. */
  async settleOrphanedRetries(conversationId: string): Promise<void> {
    const history = await this.store.history(conversationId);
    const tracked = this.openRetries.get(conversationId);
    const orphaned = history.filter(
      (entry): entry is RetryEntry => entry.type === 'retry' && !entry.closed && !tracked?.has(entry.id),
    );
    await Promise.all(orphaned.map(retry => this.publishEntry(conversationId, { ...retry, closed: true })));
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

  /** The delegations of the conversation that started in this process and have not ended. */
  liveDelegationsOf(conversationId: string): ReadonlySet<string> {
    return this.liveDelegations.get(conversationId) ?? new Set();
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

  /** An idle conversation has nothing being written nor delegated, whatever way the turn ended. */
  publishState(conversationId: string, state: ConversationState): void {
    if (state === 'idle') {
      this.publishDraft(conversationId, '');
      this.liveDelegations.delete(conversationId);
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

  private async place(conversationId: string, entry: ConversationEntry): Promise<void> {
    let position: number;
    try {
      position = await this.store.upsertEntry(conversationId, entry);
    } catch (error) {
      this.logger.error(`entry_not_persisted: ${conversationId}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (this.deliversResponse(entry)) {
      this.publishDraft(conversationId, '');
    }
    this.registry.broadcast({ type: 'conversation.entry', conversationId, entry, position });
  }

  private trackDelegation(conversationId: string, entry: ConversationEntry): void {
    if (entry.type !== 'delegation') {
      return;
    }
    const live = this.liveDelegations.get(conversationId) ?? new Set<string>();
    if (entry.phase === 'started') {
      live.add(entry.delegationId);
    } else {
      live.delete(entry.delegationId);
    }
    this.liveDelegations.set(conversationId, live);
  }

  private trackRetry(conversationId: string, entry: ConversationEntry): void {
    if (entry.type !== 'retry') {
      return;
    }
    const open = this.openRetries.get(conversationId) ?? new Map<string, RetryEntry>();
    if (entry.closed) {
      open.delete(entry.id);
    } else {
      open.set(entry.id, entry);
    }
    this.openRetries.set(conversationId, open);
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
