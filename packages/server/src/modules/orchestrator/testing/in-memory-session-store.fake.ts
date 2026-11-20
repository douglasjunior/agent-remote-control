import type { SessionContext } from '../models/session-context.model.js';
import type { ISessionStorePort, SessionChange } from '../ports/session-store.port.js';


export class InMemorySessionStoreFake implements ISessionStorePort {
  private readonly sessions = new Map<string, SessionContext>();

  async findSession(conversationId: string): Promise<SessionContext | null> {
    return this.sessions.get(conversationId) ?? null;
  }

  async updateSession(conversationId: string, change: SessionChange): Promise<SessionContext> {
    const current = this.sessions.get(conversationId) ?? { conversationId, agentSessions: [] };
    const updated = change(current);
    if (updated) {
      this.sessions.set(conversationId, updated);
    }
    return updated ?? current;
  }

  /** Stores the session as given, as an earlier turn would have left it. */
  seed(session: SessionContext): void {
    this.sessions.set(session.conversationId, session);
  }
}
