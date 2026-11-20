import { MAX_PROMPT_HISTORY } from '@agent-remote-control/protocol/limits';
import { Injectable } from '@nestjs/common';
import { join } from 'node:path';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';

import type { ILegacyJsonImporterPort, LegacyJsonImport } from '../../database/ports/legacy-json-importer.port.js';
import { LegacyJsonFilesService } from '../../database/services/legacy-json-files.service.js';
import { PromptHistoryEntity } from '../entities/prompt-history.entity.js';


const PROMPT_HISTORY_FILE = join('web', 'prompt-history.json');

/** `DATA_DIR/web/prompt-history.json`, the prompts most recent first. */
@Injectable()
export class JsonPromptHistoryImporterAdapter implements ILegacyJsonImporterPort {
  readonly name = 'web-prompt-history';

  constructor(private readonly files: LegacyJsonFilesService) {}

  async read(): Promise<LegacyJsonImport> {
    const stored = await this.files.read(PROMPT_HISTORY_FILE, z.array(z.string()));
    const prompts = (stored ?? []).slice(0, MAX_PROMPT_HISTORY);
    return {
      files: stored ? [PROMPT_HISTORY_FILE] : [],
      counts: { prompts: prompts.length },
      write: async (manager: EntityManager) => {
        if (prompts.length > 0) {
          await manager.insert(PromptHistoryEntity, prompts.toReversed().map(prompt => ({ prompt })));
        }
      },
    };
  }
}
