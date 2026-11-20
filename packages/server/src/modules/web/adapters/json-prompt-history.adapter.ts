import { MAX_PROMPT_HISTORY } from '@agent-remote-control/protocol/limits';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { join } from 'node:path';
import { z } from 'zod';

import { DataDirectoryService } from '../../paths/services/data-directory.service.js';
import { ILockedFilesPort, type LockedFile } from '../../storage/ports/locked-files.port.js';
import type { IPromptHistoryPort } from '../ports/prompt-history.port.js';


/**
 * `DATA_DIR/web/prompt-history.json`. The history is a convenience, so a prompt that cannot be written is logged and
 * left out rather than failing the message that sent it.
 */
@Injectable()
export class JsonPromptHistoryAdapter implements IPromptHistoryPort {
  private readonly logger = new Logger(JsonPromptHistoryAdapter.name);
  private readonly file: LockedFile<readonly string[]>;

  constructor(dataDirectoryService: DataDirectoryService, @Inject(ILockedFilesPort) files: ILockedFilesPort) {
    const path = join(dataDirectoryService.resolve(), 'web', 'prompt-history.json');
    this.file = files.json<readonly string[]>(path, {
      parse: (content) => {
        const parsed = z.array(z.string()).safeParse(content);
        if (!parsed.success) {
          this.logger.warn(`prompt_history_invalid_file: ${path}`);
          return [];
        }
        return parsed.data.slice(0, MAX_PROMPT_HISTORY);
      },
      empty: [],
    });
  }

  async list(): Promise<readonly string[]> {
    return [...await this.file.read()];
  }

  async append(prompt: string): Promise<void> {
    try {
      await this.file.update(prompts => (prompts[0] === prompt ? undefined : [prompt, ...prompts].slice(0, MAX_PROMPT_HISTORY)));
    } catch (error) {
      this.logger.error(`prompt_history_write_failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
