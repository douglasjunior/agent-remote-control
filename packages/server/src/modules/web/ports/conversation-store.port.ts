import type { ConversationSummary } from '@agent-remote-control/protocol/conversation';
import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';


export interface IConversationStorePort {
  /** Most recently updated first. */
  list(): Promise<readonly ConversationSummary[]>;
  create(): Promise<ConversationSummary>;
  rename(id: string, title: string): Promise<ConversationSummary>;
  touch(id: string): Promise<ConversationSummary>;
  exists(id: string): Promise<boolean>;
  history(id: string): Promise<readonly ConversationEntry[]>;
  /** Replaces the entry with the same `id` in place, or appends it. */
  upsertEntry(id: string, entry: ConversationEntry): Promise<void>;
  /** Persists the pending changes of a conversation immediately. */
  flush(id: string): Promise<void>;
}

export const IConversationStorePort = Symbol('IConversationStorePort');
