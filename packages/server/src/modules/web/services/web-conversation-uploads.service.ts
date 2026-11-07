import type { Attachment } from '@agent-remote-control/protocol/attachment';
import { Inject, Injectable } from '@nestjs/common';
import { extname, resolve } from 'node:path';

import type { TurnAttachment } from '../../orchestrator/models/turn-attachment.model.js';
import { IWorkspaceUploadPort } from '../../workspace/ports/workspace-upload.port.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import { isUploadPathOf } from '../utils/upload-path.util.js';


const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm',
};

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
        : { name, path: resolve(this.workspace.getBaseDirectory(), path), contentType: this.contentTypeOf(name), size };
    }));
    return files.every(file => file !== null) ? files : null;
  }

  /** From the extension, as the browser gives no trustworthy content type to the server. */
  private contentTypeOf(fileName: string): string {
    return CONTENT_TYPES[extname(fileName).toLowerCase()] ?? 'application/octet-stream';
  }
}
