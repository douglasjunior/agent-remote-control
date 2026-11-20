import { Inject, Injectable } from '@nestjs/common';
import { join } from 'node:path';

import { DataDirectoryService } from '../../paths/services/data-directory.service.js';
import { ILockedFilesPort, type LockedFile } from '../../storage/ports/locked-files.port.js';
import type { IOpenWorkStorePort, OpenWorkByConversation } from '../ports/open-work-store.port.js';


const OPEN_WORK_FILENAME = 'open-work.json';

/** `DATA_DIR/open-work.json`: the work in progress of every conversation, by conversation id. */
@Injectable()
export class JsonOpenWorkStoreAdapter implements IOpenWorkStorePort {
  private readonly file: LockedFile<OpenWorkByConversation>;

  constructor(dataDirectoryService: DataDirectoryService, @Inject(ILockedFilesPort) files: ILockedFilesPort) {
    this.file = files.json<OpenWorkByConversation>(join(dataDirectoryService.resolve(), OPEN_WORK_FILENAME), {
      parse: content => (content !== null && typeof content === 'object' && !Array.isArray(content) ? content as OpenWorkByConversation : {}),
      empty: {},
    });
  }

  load(): Promise<OpenWorkByConversation> {
    return this.file.read();
  }

  async update(change: (work: OpenWorkByConversation) => OpenWorkByConversation): Promise<void> {
    await this.file.update(change);
  }
}
