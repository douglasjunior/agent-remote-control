import type { SessionContext } from '../models/session-context.model.js';
import type { ISessionStorePort } from '../ports/session-store.port.js';


export class InMemorySessionStoreFake implements ISessionStorePort {
  private readonly sessions = new Map<string, SessionContext>();

  async findSession(conversationId: string): Promise<SessionContext | null> {
    for (const session of this.sessions.values()) {
      if (session.conversationId === conversationId) {
        return session;
      }
    }
    return null;
  }

  async saveSession(session: SessionContext): Promise<void> {
    this.sessions.set(session.sessionId, session);
  }
}
