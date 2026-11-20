import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { Injectable, Logger } from '@nestjs/common';
import { basename, join } from 'node:path';
import { DataSource, type EntityManager } from 'typeorm';
import { z } from 'zod';

import type { ILegacyJsonImporterPort, LegacyJsonImport } from '../../database/ports/legacy-json-importer.port.js';
import { LegacyJsonFilesService } from '../../database/services/legacy-json-files.service.js';
import { ConversationEntryEntity } from '../entities/conversation-entry.entity.js';
import { LegacyConversationEntryUpgraderService } from '../services/legacy-conversation-entry-upgrader.service.js';
import { insertInBatches } from '../utils/insert-in-batches.util.js';


const HISTORY_DIRECTORY = join('web', 'history');

interface ConversationState {
  readonly id: string;
  readonly createdAt: string;
  readonly hasEntries: number;
}

interface ImportedHistory {
  readonly entries: ConversationEntryEntity[];
  readonly upgraded: number;
  readonly warnings: number;
}

/**
 * `DATA_DIR/web/history/<id>.json`, the entries of each conversation, every one converted to the current format by
 * `LegacyConversationEntryUpgraderService`. A file is imported only when its conversation is in the database and has
 * no entries, so the import is idempotent per conversation; it runs after `JsonConversationsImporterAdapter`, which
 * creates the conversations. A file that is not a JSON array, one of no conversation and one of a conversation that
 * has entries stay in place and are logged, like the `*.tmp` files of writes that never finished.
 */
@Injectable()
export class JsonHistoriesImporterAdapter implements ILegacyJsonImporterPort {
  readonly name = 'web-histories';
  private readonly logger = new Logger(JsonHistoriesImporterAdapter.name);

  constructor(
    private readonly files: LegacyJsonFilesService,
    private readonly dataSource: DataSource,
    private readonly upgrader: LegacyConversationEntryUpgraderService,
  ) {}

  async read(): Promise<LegacyJsonImport> {
    const conversations = await this.conversations();
    const files: string[] = [];
    const entries: ConversationEntryEntity[] = [];
    let upgraded = 0;
    let warnings = 0;
    for (const path of await this.files.list(HISTORY_DIRECTORY)) {
      const conversation = conversations.get(basename(path, '.json'));
      if (!conversation || conversation.hasEntries) {
        this.logger.warn(`legacy_file_skipped: ${path} ${conversation ? 'belongs to a conversation that already has entries' : 'belongs to no conversation of the database'}`);
        continue;
      }
      const history = await this.files.read(path, z.array(z.unknown()));
      if (!history) {
        continue;
      }
      const imported = this.toEntries(path, conversation, history);
      files.push(path);
      entries.push(...imported.entries);
      upgraded += imported.upgraded;
      warnings += imported.warnings;
    }
    for (const path of await this.files.listTemporary(HISTORY_DIRECTORY)) {
      this.logger.warn(`legacy_file_skipped: ${path} is what a write that never finished left behind`);
    }
    return {
      files,
      counts: { histories: files.length, entries: entries.length, upgraded, warnings },
      write: (manager: EntityManager) => insertInBatches(manager, ConversationEntryEntity, entries),
    };
  }

  private async conversations(): Promise<Map<string, ConversationState>> {
    const rows = await this.dataSource.query<ConversationState[]>(
      `SELECT c.id AS id, c.created_at AS createdAt,
        EXISTS (SELECT 1 FROM conversation_entry e WHERE e.conversation_id = c.id) AS hasEntries
      FROM conversation c`,
    );
    return new Map(rows.map(row => [row.id, row]));
  }

  /**
   * An entry id appears once in a history, at the place it first took, holding its latest version. An entry that
   * lacks an id or a time takes `legacy-<its place in the file>` and the time of the entry before it, or the creation
   * of the conversation.
   */
  private toEntries(path: string, conversation: ConversationState, history: readonly unknown[]): ImportedHistory {
    const latest = new Map<string, ConversationEntry>();
    let upgraded = 0;
    let warnings = 0;
    let previousAt = conversation.createdAt;
    history.forEach((raw, index) => {
      const result = this.upgrader.upgrade(raw, { id: `legacy-${index}`, at: previousAt });
      upgraded += result.outcome === 'upgraded' ? 1 : 0;
      warnings += result.outcome === 'warning' ? 1 : 0;
      previousAt = result.entry.at;
      latest.set(result.entry.id, result.entry);
    });
    if (upgraded + warnings > 0) {
      this.logger.log(`legacy_entries_upgraded: ${path}: ${upgraded} upgraded, ${warnings} turned into warning notices`);
    }
    const entries = [...latest.values()].map((entry, position) => ({
      conversationId: conversation.id,
      entryId: entry.id,
      position,
      at: entry.at,
      type: entry.type,
      payload: JSON.stringify(entry),
    }));
    return { entries, upgraded, warnings };
  }
}
