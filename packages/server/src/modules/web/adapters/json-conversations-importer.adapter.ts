import { conversationSummarySchema, type ConversationSummary } from '@agent-remote-control/protocol/conversation';
import { conversationEntrySchema, type ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Injectable, Logger } from '@nestjs/common';
import { join } from 'node:path';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';

import type { ILegacyJsonImporterPort, LegacyJsonImport } from '../../database/ports/legacy-json-importer.port.js';
import { LegacyJsonFilesService } from '../../database/services/legacy-json-files.service.js';
import { ConversationEntryEntity } from '../entities/conversation-entry.entity.js';
import { ConversationEntity } from '../entities/conversation.entity.js';


const INDEX_FILE = join('web', 'conversations.json');
const HISTORY_DIRECTORY = join('web', 'history');
/** Keeps an id read from a file from reaching outside the history directory. */
const FILE_NAME_ID = /^[\w-]+$/;
/** Rows per insert, well under the limit of bound parameters of a SQLite statement. */
const INSERT_BATCH = 500;

/** `DATA_DIR/web/conversations.json`, the summaries, and `DATA_DIR/web/history/<id>.json`, the entries of each. */
@Injectable()
export class JsonConversationsImporterAdapter implements ILegacyJsonImporterPort {
  readonly name = 'web-conversations';
  private readonly logger = new Logger(JsonConversationsImporterAdapter.name);

  constructor(private readonly files: LegacyJsonFilesService) {}

  async read(): Promise<LegacyJsonImport> {
    const index = await this.files.read(INDEX_FILE, z.array(conversationSummarySchema));
    const summaries = [...new Map((index ?? []).map(summary => [summary.id, summary])).values()].filter(summary => FILE_NAME_ID.test(summary.id));
    const files = index ? [INDEX_FILE] : [];
    const conversations = summaries.map(summary => this.toConversation(summary));
    const entries: ConversationEntryEntity[] = [];
    for (const summary of summaries) {
      const path = this.historyFile(summary.id);
      const history = await this.files.read(path, z.array(conversationEntrySchema));
      if (history) {
        files.push(path);
        entries.push(...this.toEntries(summary.id, history));
      }
    }
    await this.warnOrphans(new Set(summaries.map(summary => this.historyFile(summary.id))));
    return {
      files,
      counts: { conversations: conversations.length, entries: entries.length },
      write: async (manager: EntityManager) => {
        await this.insert(manager, ConversationEntity, conversations);
        await this.insert(manager, ConversationEntryEntity, entries);
      },
    };
  }

  private historyFile(id: string): string {
    return join(HISTORY_DIRECTORY, `${id}.json`);
  }

  private toConversation({ id, title, createdAt, updatedAt, archivedAt }: ConversationSummary): ConversationEntity {
    return { id, title, createdAt, updatedAt, archivedAt: archivedAt ?? null };
  }

  /** An entry id appears once in a history, at the place it first took, holding its latest version. */
  private toEntries(conversationId: string, history: readonly ConversationEntry[]): ConversationEntryEntity[] {
    const latest = new Map(history.map(entry => [entry.id, entry]));
    return [...latest.values()].map((entry, position) => ({
      conversationId,
      entryId: entry.id,
      position,
      at: entry.at,
      type: entry.type,
      payload: JSON.stringify(entry),
    }));
  }

  private async warnOrphans(known: ReadonlySet<string>): Promise<void> {
    for (const path of await this.files.list(HISTORY_DIRECTORY)) {
      if (!known.has(path)) {
        this.logger.warn(`legacy_file_skipped: ${path} belongs to no conversation of ${INDEX_FILE}`);
      }
    }
  }

  private async insert<T extends object>(manager: EntityManager, entity: new () => T, rows: readonly T[]): Promise<void> {
    for (let start = 0; start < rows.length; start += INSERT_BATCH) {
      await manager.insert(entity, rows.slice(start, start + INSERT_BATCH));
    }
  }
}
