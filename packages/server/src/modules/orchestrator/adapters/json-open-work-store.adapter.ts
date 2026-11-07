import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DataDirectoryService } from '../../paths/services/data-directory.service.js';
import type { IOpenWorkStorePort, OpenWorkByConversation } from '../ports/open-work-store.port.js';


const OPEN_WORK_FILENAME = 'open-work.json';

@Injectable()
export class JsonOpenWorkStoreAdapter implements IOpenWorkStorePort {
  private readonly logger = new Logger(JsonOpenWorkStoreAdapter.name);
  private readonly dataDirectory: string;
  private readonly filePath: string;

  constructor(dataDirectoryService: DataDirectoryService) {
    this.dataDirectory = dataDirectoryService.resolve();
    this.filePath = join(this.dataDirectory, OPEN_WORK_FILENAME);
  }

  async load(): Promise<OpenWorkByConversation> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf-8'));
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as OpenWorkByConversation : {};
    } catch {
      this.logger.debug(`open_work_read_skipped: ${this.filePath}`);
      return {};
    }
  }

  /** Renames a complete file into place, because the process may die at any moment of a write. */
  async save(work: OpenWorkByConversation): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(work, null, 2), 'utf-8');
    await rename(temporary, this.filePath);
  }
}
