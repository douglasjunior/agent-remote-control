import type { SessionContext } from '../models/session-context.model.js';


export interface ISessionStorePort {
  findSession(conversationId: string): Promise<SessionContext | null>;
  saveSession(session: SessionContext): Promise<void>;
}

export const ISessionStorePort = Symbol('ISessionStorePort');
