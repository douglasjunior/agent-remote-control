import type { OpenWork } from '../models/open-work.model.js';


export type OpenWorkByConversation = Readonly<Record<string, readonly OpenWork[]>>;

export interface IOpenWorkStorePort {
  load(): Promise<OpenWorkByConversation>;
  /** Replaces the stored work with what `change` returns from it, as one step that no other change interleaves. */
  update(change: (work: OpenWorkByConversation) => OpenWorkByConversation): Promise<void>;
}

export const IOpenWorkStorePort = Symbol('IOpenWorkStorePort');
