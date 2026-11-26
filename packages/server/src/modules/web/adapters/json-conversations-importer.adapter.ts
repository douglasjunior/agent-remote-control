import { conversationSummarySchema, type ConversationSummary } from '@agent-remote-control/protocol/conversation';
import { Injectable } from '@nestjs/common';
import { join } from 'node:path';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';

import type { ILegacyJsonImporterPort, LegacyJsonImport } from '../../database/ports/legacy-json-importer.port.js';
import { LegacyJsonFilesService } from '../../database/services/legacy-json-files.service.js';
import { ConversationEntity } from '../entities/conversation.entity.js';
import { insertInBatches } from '../utils/insert-in-batches.util.js';


const INDEX_FILE = join('web', 'conversations.json');
/** The histories are files named after the conversation id, so an id that is not a file name is left out. */
const FILE_NAME_ID = /^[\w-]+$/;

/** `DATA_DIR/web/conversations.json`, the summaries. The entries of each conversation come from `JsonHistoriesImporterAdapter`, which runs after it. */
@Injectable()
export class JsonConversationsImporterAdapter implements ILegacyJsonImporterPort {
  readonly name = 'web-conversations';

  constructor(private readonly files: LegacyJsonFilesService) {}

  async read(): Promise<LegacyJsonImport> {
    const index = await this.files.read(INDEX_FILE, z.array(conversationSummarySchema));
    const summaries = [...new Map((index ?? []).map(summary => [summary.id, summary])).values()].filter(summary => FILE_NAME_ID.test(summary.id));
    const conversations = summaries.map(summary => this.toConversation(summary));
    return {
      files: index ? [INDEX_FILE] : [],
      counts: { conversations: conversations.length },
      write: (manager: EntityManager) => insertInBatches(manager, ConversationEntity, conversations),
    };
  }

  private toConversation({ id, title, createdAt, updatedAt, archivedAt }: ConversationSummary): ConversationEntity {
    return { id, title, createdAt, updatedAt, archivedAt: archivedAt ?? null };
  }
}
