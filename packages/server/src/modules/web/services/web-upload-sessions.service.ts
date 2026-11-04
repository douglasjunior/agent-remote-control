import { MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from '@agent-remote-control/protocol/limits';
import { Inject, Injectable } from '@nestjs/common';
import { basename } from 'node:path/posix';

import { IWorkspaceUploadPort, type UploadWriter } from '../../workspace/ports/workspace-upload.port.js';
import type { IClientConnection } from '../ports/client-transport.port.js';
import { uploadDirectory } from '../utils/upload-path.util.js';


export const UPLOAD_IDLE_TIMEOUT_MS = 60_000;
export const MAX_CONCURRENT_UPLOADS = 5;

type Upload = {
  readonly connection: IClientConnection;
  readonly writer: UploadWriter;
  readonly size: number;
  received: number;
  nextIndex: number;
  idleTimer: NodeJS.Timeout;
  /** Chunks are applied one after the other, in the order they arrived. */
  queue: Promise<void>;
};

/**
 * Uploads in progress, keyed by connection and `uploadId`. A file arrives as ordered base64 chunks that
 * the client sends one at a time, waiting for each `upload.ack`. Any violation (size, order, an unknown
 * id, silence for `UPLOAD_IDLE_TIMEOUT_MS`) discards the partial file and answers `upload.failed`.
 */
@Injectable()
export class WebUploadSessionsService {
  private readonly uploads = new Map<string, Upload>();

  constructor(@Inject(IWorkspaceUploadPort) private readonly files: IWorkspaceUploadPort) {}

  async start(
    connection: IClientConnection,
    command: { readonly uploadId: string; readonly conversationId: string; readonly name: string; readonly size: number },
  ): Promise<void> {
    const key = this.key(connection.id, command.uploadId);
    if (this.uploads.has(key)) {
      this.fail(connection, command.uploadId, 'Upload id already in use');
      return;
    }
    if (command.size > MAX_UPLOAD_BYTES) {
      this.fail(connection, command.uploadId, 'File is too large');
      return;
    }
    if (this.countOf(connection.id) >= MAX_CONCURRENT_UPLOADS) {
      this.fail(connection, command.uploadId, 'Too many uploads in progress');
      return;
    }
    const upload: Upload = {
      connection,
      writer: await this.files.begin(uploadDirectory(command.conversationId), command.name),
      size: command.size,
      received: 0,
      nextIndex: 0,
      idleTimer: this.idleTimer(key, command.uploadId),
      queue: Promise.resolve(),
    };
    this.uploads.set(key, upload);
    connection.send({ type: 'upload.ready', uploadId: command.uploadId });
  }

  chunk(connection: IClientConnection, command: { readonly uploadId: string; readonly index: number; readonly dataBase64: string }): Promise<void> {
    return this.enqueue(connection, command.uploadId, async (upload) => {
      const bytes = Buffer.from(command.dataBase64, 'base64');
      if (command.index !== upload.nextIndex) {
        return this.discard(connection, command.uploadId, 'Chunk out of order');
      }
      if (bytes.length > UPLOAD_CHUNK_BYTES || upload.received + bytes.length > upload.size) {
        return this.discard(connection, command.uploadId, 'Chunk exceeds the announced size');
      }
      upload.nextIndex += 1;
      upload.received += bytes.length;
      await upload.writer.append(bytes);
      this.touch(connection.id, command.uploadId, upload);
      connection.send({ type: 'upload.ack', uploadId: command.uploadId, index: command.index });
    });
  }

  finish(connection: IClientConnection, uploadId: string): Promise<void> {
    return this.enqueue(connection, uploadId, async (upload) => {
      if (upload.received !== upload.size) {
        return this.discard(connection, uploadId, 'File is incomplete');
      }
      clearTimeout(upload.idleTimer);
      this.uploads.delete(this.key(connection.id, uploadId));
      const path = await upload.writer.commit();
      connection.send({ type: 'upload.done', uploadId, attachment: { path, name: basename(path) } });
    });
  }

  abort(connectionId: string, uploadId: string): Promise<void> {
    return this.release(this.key(connectionId, uploadId));
  }

  /** Drops every upload of a connection that went away. */
  async releaseConnection(connectionId: string): Promise<void> {
    const keys = [...this.uploads.entries()].filter(([, upload]) => upload.connection.id === connectionId).map(([key]) => key);
    await Promise.all(keys.map(key => this.release(key)));
  }

  private async enqueue(connection: IClientConnection, uploadId: string, step: (upload: Upload) => Promise<void>): Promise<void> {
    const upload = this.uploads.get(this.key(connection.id, uploadId));
    if (!upload) {
      this.fail(connection, uploadId, 'Unknown upload');
      return;
    }
    upload.queue = upload.queue.then(() => step(upload)).catch(async (error: unknown) => {
      await this.discard(connection, uploadId, error instanceof Error ? error.message : 'Upload failed');
    });
    await upload.queue;
  }

  private async discard(connection: IClientConnection, uploadId: string, reason: string): Promise<void> {
    await this.release(this.key(connection.id, uploadId));
    this.fail(connection, uploadId, reason);
  }

  private async release(key: string): Promise<void> {
    const upload = this.uploads.get(key);
    if (!upload) {
      return;
    }
    clearTimeout(upload.idleTimer);
    this.uploads.delete(key);
    await upload.writer.abort();
  }

  private touch(connectionId: string, uploadId: string, upload: Upload): void {
    clearTimeout(upload.idleTimer);
    upload.idleTimer = this.idleTimer(this.key(connectionId, uploadId), uploadId);
  }

  private idleTimer(key: string, uploadId: string): NodeJS.Timeout {
    const timer = setTimeout(() => {
      const upload = this.uploads.get(key);
      if (upload) {
        void this.release(key).then(() => this.fail(upload.connection, uploadId, 'Upload timed out'));
      }
    }, UPLOAD_IDLE_TIMEOUT_MS);
    timer.unref();
    return timer;
  }

  private countOf(connectionId: string): number {
    return [...this.uploads.values()].filter(upload => upload.connection.id === connectionId).length;
  }

  private key(connectionId: string, uploadId: string): string {
    return `${connectionId}:${uploadId}`;
  }

  private fail(connection: IClientConnection, uploadId: string, reason: string): void {
    connection.send({ type: 'upload.failed', uploadId, reason });
  }
}
