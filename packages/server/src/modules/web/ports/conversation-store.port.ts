import type { ConversationSummary } from '@agent-remote-control/protocol/conversation';
import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';


export interface IConversationStorePort {
  /** Most recently updated first. */
  list(): Promise<readonly ConversationSummary[]>;
  create(): Promise<ConversationSummary>;
  /** Changes the title only: a rename is not activity, so the conversation keeps its place in the list. */
  rename(id: string, title: string): Promise<ConversationSummary>;
  /** Stamps `archivedAt`, or clears it with `archived: false`, without moving the conversation in the list. */
  archive(id: string, archived: boolean): Promise<ConversationSummary>;
  /** Marks activity, moving the conversation to the top of the list. */
  touch(id: string): Promise<ConversationSummary>;
  exists(id: string): Promise<boolean>;
  history(id: string): Promise<readonly ConversationEntry[]>;
  /** Replaces the entry with the same `id` in place, or appends it. */
  upsertEntry(id: string, entry: ConversationEntry): Promise<void>;
  /** Persists the pending changes of a conversation immediately. */
  flush(id: string): Promise<void>;
}

export const IConversationStorePort = Symbol('IConversationStorePort');
