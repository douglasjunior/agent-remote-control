import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';

import type { ILegacyJsonImporterPort, LegacyJsonImport } from '../../database/ports/legacy-json-importer.port.js';
import { LegacyJsonFilesService } from '../../database/services/legacy-json-files.service.js';
import { AgentSessionEntity } from '../entities/agent-session.entity.js';
import { SessionEntity } from '../entities/session.entity.js';
import type { AgentSession } from '../models/agent-session.model.js';


const SESSIONS_FILE = 'sessions.json';
const ROWS_PER_INSERT = 500;

/** An item of the earliest format is keyed by `conversationId`, or by `channelId` and `threadId`; other fields are dropped. */
const storedSessionSchema = z.object({
  conversationId: z.string().optional(),
  channelId: z.string().optional(),
  threadId: z.string().optional(),
  agentSessions: z.array(z.unknown()).optional(),
});
const sessionsFileSchema = z.union([z.array(storedSessionSchema), z.record(z.string(), storedSessionSchema)]);

/** Entries written before the project and the artifact took part in a session's identity have neither. */
const storedAgentSessionSchema = z.object({
  role: z.string(),
  agentId: z.string(),
  sessionId: z.string(),
  projectName: z.string().nullish().transform(value => value ?? null),
  artifactId: z.string().nullish().transform(value => value ?? null),
  workEndedAt: z.string().optional().catch(undefined),
  unanswered: z.literal(true).optional().catch(undefined),
});

type StoredSession = z.infer<typeof storedSessionSchema>;

/** `DATA_DIR/sessions.json`. An agent session without an agent is dropped; when items share a conversation, the later wins. */
@Injectable()
export class JsonSessionsImporterAdapter implements ILegacyJsonImporterPort {
  readonly name = 'sessions';

  constructor(private readonly files: LegacyJsonFilesService) {}

  async read(): Promise<LegacyJsonImport> {
    const stored = await this.files.read(SESSIONS_FILE, sessionsFileSchema);
    const entries: [string, StoredSession][] = Array.isArray(stored)
      ? stored.map(item => [this.legacyConversationId(item), item])
      : Object.entries(stored ?? {});
    const sessions = new Map(entries.map(([conversationId, item]) => [conversationId, this.agentSessions(item)]));
    return {
      files: stored === undefined ? [] : [SESSIONS_FILE],
      counts: { conversations: sessions.size, agentSessions: [...sessions.values()].reduce((total, list) => total + list.length, 0) },
      write: async (manager: EntityManager) => {
        const existing = new Set((await manager.find(SessionEntity)).map(row => row.conversationId));
        const imported = [...sessions].filter(([conversationId]) => !existing.has(conversationId));
        const rows = imported.flatMap(([conversationId, agentSessions]) => agentSessions.map((session, position): AgentSessionEntity => ({
          conversationId,
          position,
          role: session.role,
          agentId: session.agentId,
          sessionId: session.sessionId,
          projectName: session.projectName,
          artifactId: session.artifactId,
          workEndedAt: session.workEndedAt ?? null,
          unanswered: session.unanswered ?? null,
        })));
        await this.insert(manager, SessionEntity, imported.map(([conversationId]) => ({ conversationId })));
        await this.insert(manager, AgentSessionEntity, rows);
      },
    };
  }

  private agentSessions(item: StoredSession): AgentSession[] {
    return (item.agentSessions ?? []).flatMap((entry) => {
      const parsed = storedAgentSessionSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  }

  private legacyConversationId({ conversationId, channelId, threadId }: StoredSession): string {
    return conversationId ?? (threadId ? `${channelId}:${threadId}` : channelId ?? '');
  }

  private async insert<T extends object>(manager: EntityManager, entity: new () => T, rows: readonly T[]): Promise<void> {
    for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
      await manager.insert(entity, rows.slice(start, start + ROWS_PER_INSERT) as T[]);
    }
  }
}
