import { Injectable, Logger, Optional } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SessionContext } from '../models/session-context.model.js';
import type { ISessionStorePort } from '../ports/session-store.port.js';
import { resolveDataDirectory } from '../utils/data-directory.util.js';


const SESSIONS_FILENAME = 'sessions.json';

type StoredSession = Omit<SessionContext, 'agentSessions' | 'createdAt' | 'updatedAt'> & {
  readonly agentSessions?: SessionContext['agentSessions'];
  readonly createdAt: string;
  readonly updatedAt: string;
};

@Injectable()
export class JsonSessionStoreAdapter implements ISessionStorePort {
  private readonly logger = new Logger(JsonSessionStoreAdapter.name);
  private readonly dataDirectory: string;
  private readonly filePath: string;
  private sessions: Promise<Map<string, SessionContext>> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(@Optional() customDataDir?: string) {
    this.dataDirectory = resolveDataDirectory(customDataDir);
    this.filePath = join(this.dataDirectory, SESSIONS_FILENAME);
  }

  async findSession(
    channelId: string,
    threadId?: string,
  ): Promise<SessionContext | null> {
    const sessions = await this.load();
    for (const session of sessions.values()) {
      if (
        session.channelId === channelId
        && (session.threadId ?? undefined) === (threadId ?? undefined)
      ) {
        return session;
      }
    }
    return null;
  }

  async saveSession(session: SessionContext): Promise<void> {
    const sessions = await this.load();
    sessions.set(session.sessionId, session);
    const content = JSON.stringify(Array.from(sessions.values()), null, 2);
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => this.write(content));
    await this.writeChain;
  }

  private load(): Promise<Map<string, SessionContext>> {
    this.sessions ??= this.read();
    return this.sessions;
  }

  private async read(): Promise<Map<string, SessionContext>> {
    const sessions = new Map<string, SessionContext>();
    try {
      const items = JSON.parse(await readFile(this.filePath, 'utf-8')) as StoredSession[];
      for (const item of items) {
        sessions.set(item.sessionId, {
          ...item,
          agentSessions: item.agentSessions ?? [],
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        });
      }
    } catch {
      this.logger.debug(`sessions_read_skipped: ${this.filePath}`);
      sessions.clear();
    }
    return sessions;
  }

  private async write(content: string): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true });
    await writeFile(this.filePath, content, 'utf-8');
  }
}
