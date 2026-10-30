import type { SessionContext } from '../models/session-context.model.js';
import type { ISessionStorePort } from '../ports/session-store.port.js';


export class InMemorySessionStoreFake implements ISessionStorePort {
  private readonly sessions = new Map<string, SessionContext>();

  async findSession(conversationId: string): Promise<SessionContext | null> {
    return this.sessions.get(conversationId) ?? null;
  }

  async saveSession(session: SessionContext): Promise<void> {
    this.sessions.set(session.conversationId, session);
  }
}
