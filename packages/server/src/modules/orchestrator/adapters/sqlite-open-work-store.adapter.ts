import { Injectable, Logger } from '@nestjs/common';

import { SqliteTransactionService, type SqliteStatements } from '../../database/services/sqlite-transaction.service.js';
import { openWorkSchema } from '../constants/open-work-schema.constant.js';
import type { OpenWorkEntity } from '../entities/open-work.entity.js';
import type { OpenWork } from '../models/open-work.model.js';
import type { IOpenWorkStorePort, OpenWorkByConversation } from '../ports/open-work-store.port.js';


const SELECT_ALL = `SELECT "conversation_id" AS "conversationId", "id", "role", "role_name" AS "roleName", "project_name" AS "projectName",
    "artifact_id" AS "artifactId", "summary", "task_spec" AS "taskSpec", "cwd", "round", "root", "questions"
  FROM "open_work" ORDER BY "conversation_id", "position"`;
const DELETE_CONVERSATION = 'DELETE FROM "open_work" WHERE "conversation_id" = ?';
const INSERT_RECORD = `INSERT INTO "open_work" ("conversation_id", "id", "position", "role", "role_name", "project_name", "artifact_id", "summary",
    "task_spec", "cwd", "round", "root", "questions") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

type OpenWorkRow = Omit<OpenWorkEntity, 'position' | 'root'> & { readonly root: number };

/**
 * One `open_work` row per record, in each conversation's order. `update` writes again only the conversations whose
 * records changed; a row that does not make a valid record is logged and left out.
 */
@Injectable()
export class SqliteOpenWorkStoreAdapter implements IOpenWorkStorePort {
  private readonly logger = new Logger(SqliteOpenWorkStoreAdapter.name);

  constructor(private readonly transactions: SqliteTransactionService) {}

  async load(): Promise<OpenWorkByConversation> {
    return this.transactions.run(statements => this.read(statements));
  }

  async update(change: (work: OpenWorkByConversation) => OpenWorkByConversation): Promise<void> {
    this.transactions.run((statements) => {
      const stored = this.read(statements);
      const next = change(stored);
      for (const conversationId of new Set([...Object.keys(stored), ...Object.keys(next)])) {
        const records = next[conversationId] ?? [];
        if (JSON.stringify(this.columns(records)) === JSON.stringify(this.columns(stored[conversationId] ?? []))) {
          continue;
        }
        statements.run(DELETE_CONVERSATION, conversationId);
        this.columns(records).forEach((values, position) => statements.run(INSERT_RECORD, conversationId, values[0], position, ...values.slice(1)));
      }
    });
  }

  /** The values of each record in the column order of `INSERT_RECORD`, after the conversation and before the position. */
  private columns(records: readonly OpenWork[]): unknown[][] {
    return records.map(record => [
      record.id,
      record.role,
      record.roleName,
      record.projectName,
      record.artifactId ?? null,
      record.summary,
      record.taskSpec,
      record.cwd,
      record.round,
      record.root ? 1 : 0,
      record.questions ? JSON.stringify(record.questions) : null,
    ]);
  }

  private read(statements: SqliteStatements): Record<string, OpenWork[]> {
    const work: Record<string, OpenWork[]> = {};
    for (const row of statements.all<OpenWorkRow>(SELECT_ALL)) {
      const parsed = openWorkSchema.safeParse({
        id: row.id,
        role: row.role,
        roleName: row.roleName,
        projectName: row.projectName,
        ...(row.artifactId !== null && { artifactId: row.artifactId }),
        summary: row.summary,
        taskSpec: row.taskSpec,
        cwd: row.cwd,
        round: row.round,
        root: row.root === 1,
        ...(row.questions !== null && { questions: this.parseJson(row.questions) }),
      });
      if (parsed.success) {
        (work[row.conversationId] ??= []).push(parsed.data);
      } else {
        this.logger.warn(`open_work_invalid_row: ${row.id} of ${row.conversationId}`);
      }
    }
    return work;
  }

  private parseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}
