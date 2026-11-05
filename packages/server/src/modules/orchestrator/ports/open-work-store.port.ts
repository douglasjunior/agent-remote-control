import type { OpenWork } from '../models/open-work.model.js';


export type OpenWorkByConversation = Readonly<Record<string, readonly OpenWork[]>>;

export interface IOpenWorkStorePort {
  load(): Promise<OpenWorkByConversation>;
  save(work: OpenWorkByConversation): Promise<void>;
}

export const IOpenWorkStorePort = Symbol('IOpenWorkStorePort');
