import { Injectable, Logger, Optional } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AgentSession } from '../models/agent-session.model.js';
import type { SessionContext } from '../models/session-context.model.js';
import type { ISessionStorePort } from '../ports/session-store.port.js';
import { resolveDataDirectory } from '../utils/data-directory.util.js';


const SESSIONS_FILENAME = 'sessions.json';

type StoredAgentSession = Omit<AgentSession, 'agentId' | 'projectName'> & {
  readonly agentId?: string;
  readonly projectName?: string | null;
};

type StoredSession = {
  readonly conversationId?: string;
  readonly channelId?: string;
  readonly threadId?: string;
  readonly agentSessions?: readonly StoredAgentSession[];
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

  async findSession(conversationId: string): Promise<SessionContext | null> {
    return (await this.load()).get(conversationId) ?? null;
  }

  async saveSession(session: SessionContext): Promise<void> {
    const sessions = await this.load();
    sessions.set(session.conversationId, session);
    const content = JSON.stringify(
      Object.fromEntries(Array.from(sessions, ([conversationId, { agentSessions }]) => [conversationId, { agentSessions }])),
      null,
      2,
    );
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
      const parsed = JSON.parse(await readFile(this.filePath, 'utf-8')) as StoredSession[] | Record<string, StoredSession>;
      const entries: [string, StoredSession][] = Array.isArray(parsed)
        ? parsed.map(item => [this.resolveLegacyConversationId(item), item])
        : Object.entries(parsed);
      for (const [conversationId, item] of entries) {
        sessions.set(conversationId, {
          conversationId,
          agentSessions: (item.agentSessions ?? []).flatMap(({ agentId, projectName, ...agentSession }) =>
            typeof agentId === 'string' ? [{ ...agentSession, agentId, projectName: projectName ?? null }] : []),
        });
      }
    } catch {
      this.logger.debug(`sessions_read_skipped: ${this.filePath}`);
      sessions.clear();
    }
    return sessions;
  }

  private resolveLegacyConversationId({ conversationId, channelId, threadId }: StoredSession): string {
    return conversationId ?? (threadId ? `${channelId}:${threadId}` : channelId ?? '');
  }

  private async write(content: string): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true });
    await writeFile(this.filePath, content, 'utf-8');
  }
}
