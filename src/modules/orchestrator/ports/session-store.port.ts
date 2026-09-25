import type { SessionContext } from '../models/session-context.model.js';


export interface ISessionStorePort {
  findSession(
    channelId: string,
    threadId?: string,
  ): Promise<SessionContext | null>;
  saveSession(session: SessionContext): Promise<void>;
  removeSession(sessionId: string): Promise<void>;
}

export const ISessionStorePort = Symbol('ISessionStorePort');
