import { Injectable } from '@nestjs/common';
import type { SessionContext } from '../models/session-context.model.js';
import type { ISessionStorePort } from '../ports/session-store.port.js';

@Injectable()
export class InMemorySessionStoreAdapter implements ISessionStorePort {
  private readonly sessions = new Map<string, SessionContext>();

  async findSession(
    channelId: string,
    threadId?: string,
  ): Promise<SessionContext | null> {
    const normalizedThreadId = threadId ?? undefined;
    for (const session of this.sessions.values()) {
      if (
        session.channelId === channelId &&
        (session.threadId ?? undefined) === normalizedThreadId
      ) {
        return session;
      }
    }
    return null;
  }

  async saveSession(session: SessionContext): Promise<void> {
    this.sessions.set(session.sessionId, session);
  }

  async removeSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
