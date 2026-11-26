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
}

interface ImportedHistory {
  readonly conversationId: string;
  readonly entries: ConversationEntryEntity[];
  readonly upgraded: number;
  readonly warnings: number;
}

/**
 * `DATA_DIR/web/history/<id>.json`, the entries of each conversation, every one converted to the current format by
 * `LegacyConversationEntryUpgraderService`; it runs after `JsonConversationsImporterAdapter`, which creates the
 * conversations. The import is idempotent per conversation:
 * - a conversation with no entries takes the file's entries;
 * - one that has entries, none of them in the file, took new ones since an earlier import left the file behind, so the
 *   file's entries go before them and the existing ones move down by as many places;
 * - one that has any entry id of the file already holds it, so the file stays in place.
 *
 * A file that is not a JSON array and one of no conversation stay in place too, like the `*.tmp` files of writes that
 * never finished. Each skip is logged.
 */
@Injectable()
export class JsonHistoriesImporterAdapter implements ILegacyJsonImporterPort {
  readonly name = 'web-histories';
  readonly requires = ['web-conversations'];
  private readonly logger = new Logger(JsonHistoriesImporterAdapter.name);

  constructor(
    private readonly files: LegacyJsonFilesService,
    private readonly dataSource: DataSource,
    private readonly upgrader: LegacyConversationEntryUpgraderService,
  ) {}

  async read(): Promise<LegacyJsonImport> {
    const conversations = await this.conversations();
    const files: string[] = [];
    const histories: ImportedHistory[] = [];
    for (const path of await this.files.list(HISTORY_DIRECTORY)) {
      const conversation = conversations.get(basename(path, '.json'));
      if (!conversation) {
        this.logger.warn(`legacy_file_skipped: ${path} belongs to no conversation of the database`);
        continue;
      }
      const history = await this.files.read(path, z.array(z.unknown()));
      if (!history) {
        continue;
      }
      const imported = this.toEntries(conversation, history);
      if (await this.holdsAny(conversation.id, imported.entries)) {
        this.logger.warn(`legacy_file_skipped: ${path} has entries the conversation already holds`);
        continue;
      }
      if (imported.upgraded + imported.warnings > 0) {
        this.logger.log(`legacy_entries_upgraded: ${path}: ${imported.upgraded} upgraded, ${imported.warnings} turned into warning notices`);
      }
      files.push(path);
      histories.push(imported);
    }
    for (const path of await this.files.listTemporary(HISTORY_DIRECTORY)) {
      this.logger.warn(`legacy_file_skipped: ${path} is what a write that never finished left behind`);
    }
    const entries = histories.flatMap(history => history.entries);
    return {
      files,
      counts: {
        histories: files.length,
        entries: entries.length,
        upgraded: histories.reduce((total, history) => total + history.upgraded, 0),
        warnings: histories.reduce((total, history) => total + history.warnings, 0),
      },
      write: async (manager: EntityManager) => {
        for (const history of histories) {
          await this.makeRoom(manager, history.conversationId, history.entries.length);
        }
        await insertInBatches(manager, ConversationEntryEntity, entries);
      },
    };
  }

  private async conversations(): Promise<Map<string, ConversationState>> {
    const rows = await this.dataSource.query<ConversationState[]>('SELECT id, created_at AS createdAt FROM conversation');
    return new Map(rows.map(row => [row.id, row]));
  }

  private async holdsAny(conversationId: string, entries: readonly ConversationEntryEntity[]): Promise<boolean> {
    const held = await this.dataSource.query<{ entryId: string }[]>('SELECT entry_id AS entryId FROM conversation_entry WHERE conversation_id = ?', [conversationId]);
    const ids = new Set(held.map(row => row.entryId));
    return entries.some(entry => ids.has(entry.entryId));
  }

  /**
   * Moves the entries of the conversation down by `count` places. SQLite checks the unique place of each row as it
   * updates it, so the places go negative first, where none can meet a place not yet moved.
   */
  private async makeRoom(manager: EntityManager, conversationId: string, count: number): Promise<void> {
    await manager.query('UPDATE conversation_entry SET position = -position - 1 WHERE conversation_id = ?', [conversationId]);
    await manager.query('UPDATE conversation_entry SET position = -position - 1 + ? WHERE conversation_id = ?', [count, conversationId]);
  }

  /**
   * An entry id appears once in a history, at the place it first took, holding its latest version. An entry that
   * lacks an id or a time takes `legacy-<its place in the file>` and the time of the entry before it, or the creation
   * of the conversation.
   */
  private toEntries(conversation: ConversationState, history: readonly unknown[]): ImportedHistory {
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
    const entries = [...latest.values()].map((entry, position) => ({
      conversationId: conversation.id,
      entryId: entry.id,
      position,
      at: entry.at,
      type: entry.type,
      payload: JSON.stringify(entry),
    }));
    return { conversationId: conversation.id, entries, upgraded, warnings };
  }
}
