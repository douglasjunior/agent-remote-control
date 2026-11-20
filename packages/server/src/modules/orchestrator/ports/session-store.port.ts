import type { SessionContext } from '../models/session-context.model.js';


/** Receives the conversation's stored session and returns the one to store, or `undefined` to leave it as it is. */
export type SessionChange = (session: SessionContext) => SessionContext | undefined;

export interface ISessionStorePort {
  findSession(conversationId: string): Promise<SessionContext | null>;
  /**
   * Applies `change` to the conversation's session, an empty one when none is stored, as one step, so the bindings that
   * parallel delegations change at once all stay. Resolves to the session stored afterwards.
   */
  updateSession(conversationId: string, change: SessionChange): Promise<SessionContext>;
}

export const ISessionStorePort = Symbol('ISessionStorePort');
