import type { ConversationSummary } from '@agent-remote-control/protocol/conversation';
import { conversationEntrySchema, type ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, type Repository } from 'typeorm';

import { ConversationEntryEntity } from '../entities/conversation-entry.entity.js';
import { ConversationEntity } from '../entities/conversation.entity.js';
import type { IConversationStorePort } from '../ports/conversation-store.port.js';


const DEFAULT_TITLE = 'New conversation';

/*
 * One statement, so it is atomic without a transaction: a new entry takes the next position of its conversation, an
 * entry already stored keeps its own, and an unknown conversation inserts nothing and returns no row.
 */
const UPSERT_ENTRY = `
  INSERT INTO "conversation_entry" ("conversation_id", "entry_id", "position", "at", "type", "payload")
  SELECT "conversation"."id", ?, (SELECT COALESCE(MAX("position") + 1, 0) FROM "conversation_entry" WHERE "conversation_id" = "conversation"."id"), ?, ?, ?
  FROM "conversation" WHERE "conversation"."id" = ?
  ON CONFLICT ("conversation_id", "entry_id") DO UPDATE SET "at" = excluded."at", "type" = excluded."type", "payload" = excluded."payload"
  RETURNING "position"`;

/** Every change is written by the call that makes it. */
@Injectable()
export class SqliteConversationStoreAdapter implements IConversationStorePort {
  private readonly logger = new Logger(SqliteConversationStoreAdapter.name);
  private readonly conversations: Repository<ConversationEntity>;
  private readonly entries: Repository<ConversationEntryEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.conversations = dataSource.getRepository(ConversationEntity);
    this.entries = dataSource.getRepository(ConversationEntryEntity);
  }

  async list(): Promise<readonly ConversationSummary[]> {
    const rows = await this.conversations.find({ order: { updatedAt: 'DESC', createdAt: 'DESC' } });
    return rows.map(row => this.toSummary(row));
  }

  async create(): Promise<ConversationSummary> {
    const now = new Date().toISOString();
    const row: ConversationEntity = { id: `web-${randomUUID()}`, title: DEFAULT_TITLE, createdAt: now, updatedAt: now, archivedAt: null };
    await this.conversations.insert(row);
    return this.toSummary(row);
  }

  rename(id: string, title: string): Promise<ConversationSummary> {
    return this.update(id, { title });
  }

  archive(id: string, archived: boolean): Promise<ConversationSummary> {
    return this.update(id, { archivedAt: archived ? new Date().toISOString() : null });
  }

  touch(id: string): Promise<ConversationSummary> {
    return this.update(id, { updatedAt: new Date().toISOString() });
  }

  exists(id: string): Promise<boolean> {
    return this.conversations.existsBy({ id });
  }

  async history(id: string): Promise<readonly ConversationEntry[]> {
    if (!(await this.exists(id))) {
      throw this.unknown(id);
    }
    const rows = await this.entries.find({ select: { entryId: true, payload: true }, where: { conversationId: id }, order: { position: 'ASC' } });
    return rows.flatMap(row => this.toEntry(id, row));
  }

  async upsertEntry(id: string, entry: ConversationEntry): Promise<number> {
    const rows: { position: number }[] = await this.dataSource.query(UPSERT_ENTRY, [entry.id, entry.at, entry.type, JSON.stringify(entry), id]);
    const [row] = rows;
    if (!row) {
      throw this.unknown(id);
    }
    return row.position;
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }

  private async update(id: string, changes: Partial<ConversationEntity>): Promise<ConversationSummary> {
    const { affected } = await this.conversations.update({ id }, changes);
    const row = affected ? await this.conversations.findOneBy({ id }) : null;
    if (!row) {
      throw this.unknown(id);
    }
    return this.toSummary(row);
  }

  private toSummary({ id, title, createdAt, updatedAt, archivedAt }: ConversationEntity): ConversationSummary {
    return { id, title, createdAt, updatedAt, ...(archivedAt ? { archivedAt } : {}) };
  }

  /** A row whose payload does not match the protocol schema is left out of the history and logged. */
  private toEntry(conversationId: string, row: Pick<ConversationEntryEntity, 'entryId' | 'payload'>): ConversationEntry[] {
    const parsed = conversationEntrySchema.safeParse(this.parseJson(row.payload));
    if (!parsed.success) {
      this.logger.warn(`conversation_entry_invalid: ${conversationId}: ${row.entryId}`);
      return [];
    }
    return [parsed.data];
  }

  private parseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  private unknown(id: string): Error {
    return new Error(`Unknown conversation: ${id}`);
  }
}
