import { Inject, Injectable } from '@nestjs/common';
import { join } from 'node:path';

import { DataDirectoryService } from '../../paths/services/data-directory.service.js';
import { ILockedFilesPort, type LockedFile } from '../../storage/ports/locked-files.port.js';
import type { AgentSession } from '../models/agent-session.model.js';
import type { SessionContext } from '../models/session-context.model.js';
import type { ISessionStorePort, SessionChange } from '../ports/session-store.port.js';


const SESSIONS_FILENAME = 'sessions.json';

type StoredAgentSession = Omit<AgentSession, 'agentId' | 'projectName' | 'artifactId'> & {
  readonly agentId?: string;
  readonly projectName?: string | null;
  readonly artifactId?: string | null;
};

type StoredSession = {
  readonly conversationId?: string;
  readonly channelId?: string;
  readonly threadId?: string;
  readonly agentSessions?: readonly StoredAgentSession[];
};

type SessionsByConversation = ReadonlyMap<string, SessionContext>;

/** `DATA_DIR/sessions.json`: the agent sessions of every conversation, by conversation id. */
@Injectable()
export class JsonSessionStoreAdapter implements ISessionStorePort {
  private readonly file: LockedFile<SessionsByConversation>;

  constructor(dataDirectoryService: DataDirectoryService, @Inject(ILockedFilesPort) files: ILockedFilesPort) {
    this.file = files.json<SessionsByConversation>(join(dataDirectoryService.resolve(), SESSIONS_FILENAME), {
      parse: content => this.parse(content),
      empty: new Map(),
      serialize: sessions => Object.fromEntries(Array.from(sessions, ([conversationId, { agentSessions }]) => [conversationId, { agentSessions }])),
    });
  }

  async findSession(conversationId: string): Promise<SessionContext | null> {
    return (await this.file.read()).get(conversationId) ?? null;
  }

  async updateSession(conversationId: string, change: SessionChange): Promise<SessionContext> {
    const empty: SessionContext = { conversationId, agentSessions: [] };
    const sessions = await this.file.update((all) => {
      const updated = change(all.get(conversationId) ?? empty);
      return updated ? new Map(all).set(conversationId, updated) : undefined;
    });
    return sessions.get(conversationId) ?? empty;
  }

  /** Content out of shape reads as no sessions at all, which the next update replaces. */
  private parse(content: unknown): SessionsByConversation {
    try {
      const entries: [string, StoredSession][] = Array.isArray(content)
        ? (content as StoredSession[]).map(item => [this.resolveLegacyConversationId(item), item])
        : Object.entries(content as Record<string, StoredSession>);
      return new Map(entries.map(([conversationId, item]) => [
        conversationId, {
          conversationId,
          agentSessions: (item.agentSessions ?? []).flatMap(({ agentId, projectName, artifactId, ...agentSession }) =>
            typeof agentId === 'string' ? [{ ...agentSession, agentId, projectName: projectName ?? null, artifactId: artifactId ?? null }] : []),
        },
      ]));
    } catch {
      return new Map();
    }
  }

  private resolveLegacyConversationId({ conversationId, channelId, threadId }: StoredSession): string {
    return conversationId ?? (threadId ? `${channelId}:${threadId}` : channelId ?? '');
  }
}
