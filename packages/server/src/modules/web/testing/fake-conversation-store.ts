import type { ConversationSummary } from '@agent-remote-control/protocol/conversation';
import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';

import type { IConversationStorePort } from '../ports/conversation-store.port.js';


export class FakeConversationStore implements IConversationStorePort {
  readonly conversations = new Map<string, ConversationSummary>();
  readonly histories = new Map<string, ConversationEntry[]>();
  readonly flushed: string[] = [];
  private counter = 0;

  async list(): Promise<readonly ConversationSummary[]> {
    return [...this.conversations.values()].reverse();
  }

  async create(): Promise<ConversationSummary> {
    this.counter += 1;
    const summary = this.seed(`web-${this.counter}`);
    return summary;
  }

  /** Registers a conversation without going through `create`. */
  seed(id: string, title = 'New conversation'): ConversationSummary {
    const summary: ConversationSummary = {
      id,
      title,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    this.conversations.set(id, summary);
    this.histories.set(id, []);
    return summary;
  }

  async rename(id: string, title: string): Promise<ConversationSummary> {
    return this.update(id, { title });
  }

  async touch(id: string): Promise<ConversationSummary> {
    return this.update(id, {});
  }

  async exists(id: string): Promise<boolean> {
    return this.conversations.has(id);
  }

  async history(id: string): Promise<readonly ConversationEntry[]> {
    return [...(this.histories.get(id) ?? [])];
  }

  async upsertEntry(id: string, entry: ConversationEntry): Promise<void> {
    const entries = this.histories.get(id) ?? [];
    const position = entries.findIndex(existing => existing.id === entry.id);
    if (position === -1) {
      entries.push(entry);
    } else {
      entries[position] = entry;
    }
    this.histories.set(id, entries);
  }

  async flush(id: string): Promise<void> {
    this.flushed.push(id);
  }

  private update(id: string, changes: Partial<ConversationSummary>): ConversationSummary {
    const current = this.conversations.get(id);
    if (!current) {
      throw new Error(`Unknown conversation: ${id}`);
    }
    const updated = { ...current, ...changes, updatedAt: '2026-01-02T00:00:00.000Z' };
    this.conversations.set(id, updated);
    return updated;
  }
}
