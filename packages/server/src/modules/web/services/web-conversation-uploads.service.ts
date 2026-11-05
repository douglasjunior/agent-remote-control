import type { Attachment } from '@agent-remote-control/protocol/attachment';
import { Inject, Injectable } from '@nestjs/common';
import { resolve } from 'node:path';

import type { TurnAttachment } from '../../orchestrator/models/turn-attachment.model.js';
import { IWorkspaceUploadPort } from '../../workspace/ports/workspace-upload.port.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import { contentTypeOf } from '../utils/content-type.util.js';
import { isUploadPathOf } from '../utils/upload-path.util.js';


@Injectable()
export class WebConversationUploadsService {
  constructor(
    @Inject(IWorkspacePort) private readonly workspace: IWorkspacePort,
    @Inject(IWorkspaceUploadPort) private readonly uploads: IWorkspaceUploadPort,
  ) {}

  /**
   * The files this conversation uploaded, in the form every channel hands the orchestrator, or `null` when one of the
   * attachments is not an existing upload of this conversation.
   */
  async resolve(conversationId: string, attachments: readonly Attachment[]): Promise<readonly TurnAttachment[] | null> {
    const files = await Promise.all(attachments.map(async ({ path, name }): Promise<TurnAttachment | null> => {
      const size = isUploadPathOf(conversationId, path) ? await this.uploads.fileSize(path) : null;
      return size === null
        ? null
        : { name, path: resolve(this.workspace.getBaseDirectory(), path), contentType: contentTypeOf(name), size };
    }));
    return files.every(file => file !== null) ? files : null;
  }
}
