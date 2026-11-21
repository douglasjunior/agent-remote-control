import { Injectable } from '@nestjs/common';

import { SqliteTransactionService, type SqliteStatements } from '../../database/services/sqlite-transaction.service.js';
import type { AgentSessionEntity } from '../entities/agent-session.entity.js';
import type { AgentSession } from '../models/agent-session.model.js';
import type { SessionContext } from '../models/session-context.model.js';
import type { ISessionStorePort, SessionChange } from '../ports/session-store.port.js';


const SELECT_SESSION = 'SELECT 1 FROM "session" WHERE "conversation_id" = ?';
const SELECT_AGENT_SESSIONS = `SELECT "role", "agent_id" AS "agentId", "session_id" AS "sessionId", "project_name" AS "projectName",
    "artifact_id" AS "artifactId", "work_ended_at" AS "workEndedAt", "unanswered", "prompt_hash" AS "promptHash"
  FROM "agent_session" WHERE "conversation_id" = ? ORDER BY "position"`;
const INSERT_SESSION = 'INSERT INTO "session" ("conversation_id") VALUES (?) ON CONFLICT ("conversation_id") DO NOTHING';
const DELETE_AGENT_SESSIONS = 'DELETE FROM "agent_session" WHERE "conversation_id" = ?';
const INSERT_AGENT_SESSION = `INSERT INTO "agent_session" ("conversation_id", "position", "role", "agent_id", "session_id", "project_name", "artifact_id",
    "work_ended_at", "unanswered", "prompt_hash") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

type AgentSessionRow = Omit<AgentSessionEntity, 'conversationId' | 'position' | 'unanswered' | 'session'> & { readonly unanswered: number | null };

/** One `session` row per conversation and one `agent_session` row per binding of it, in the order of the list. */
@Injectable()
export class SqliteSessionStoreAdapter implements ISessionStorePort {
  constructor(private readonly transactions: SqliteTransactionService) {}

  async findSession(conversationId: string): Promise<SessionContext | null> {
    return this.transactions.run(statements => this.read(statements, conversationId));
  }

  async updateSession(conversationId: string, change: SessionChange): Promise<SessionContext> {
    return this.transactions.run((statements) => {
      const stored = this.read(statements, conversationId) ?? { conversationId, agentSessions: [] };
      const updated = change(stored);
      if (!updated) {
        return stored;
      }
      statements.run(INSERT_SESSION, conversationId);
      statements.run(DELETE_AGENT_SESSIONS, conversationId);
      updated.agentSessions.forEach((session, position) => statements.run(
        INSERT_AGENT_SESSION,
        conversationId,
        position,
        session.role,
        session.agentId,
        session.sessionId,
        session.projectName,
        session.artifactId,
        session.workEndedAt ?? null,
        session.unanswered ? 1 : null,
        session.promptHash ?? null,
      ));
      return updated;
    });
  }

  private read(statements: SqliteStatements, conversationId: string): SessionContext | null {
    if (!statements.get(SELECT_SESSION, conversationId)) {
      return null;
    }
    const agentSessions = statements.all<AgentSessionRow>(SELECT_AGENT_SESSIONS, conversationId).map((row): AgentSession => ({
      role: row.role,
      agentId: row.agentId,
      sessionId: row.sessionId,
      projectName: row.projectName,
      artifactId: row.artifactId,
      ...(row.workEndedAt !== null && { workEndedAt: row.workEndedAt }),
      ...(row.unanswered ? { unanswered: true as const } : {}),
      ...(row.promptHash !== null && { promptHash: row.promptHash }),
    }));
    return { conversationId, agentSessions };
  }
}
