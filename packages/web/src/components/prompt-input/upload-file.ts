import type { Attachment } from '@agent-remote-control/protocol/attachment';
import { UPLOAD_CHUNK_BYTES } from '@agent-remote-control/protocol/limits';

import type { IServerConnection } from '../../connection/server-connection.js';


function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Sends a file to the conversation's upload directory over the connection, in chunks of
 * `UPLOAD_CHUNK_BYTES`, waiting for the `upload.ack` of each one before sending the next. It resolves
 * with the stored attachment, and rejects when the server refuses, the connection stops being `open`
 * or `signal` aborts (which also tells the server to discard the partial file).
 */
export function uploadFile(
  connection: IServerConnection,
  conversationId: string,
  file: File,
  signal: AbortSignal,
): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const uploadId = crypto.randomUUID();
    const cleanups: (() => void)[] = [];
    let settled = false;

    const settle = (outcome: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanups.forEach(cleanup => cleanup());
      outcome();
    };
    const fail = (error: Error) => settle(() => reject(error));

    const sendChunk = async (index: number) => {
      const start = index * UPLOAD_CHUNK_BYTES;
      if (start >= file.size) {
        connection.send({ type: 'upload.finish', uploadId });
        return;
      }
      try {
        const dataBase64 = await readBase64(file.slice(start, start + UPLOAD_CHUNK_BYTES));
        if (!settled) {
          connection.send({ type: 'upload.chunk', uploadId, index, dataBase64 });
        }
      } catch (error) {
        connection.send({ type: 'upload.abort', uploadId });
        fail(error instanceof Error ? error : new Error('Could not read the file'));
      }
    };

    cleanups.push(connection.onEvent((event) => {
      if (!('uploadId' in event) || event.uploadId !== uploadId) {
        return;
      }
      if (event.type === 'upload.ready') {
        void sendChunk(0);
      } else if (event.type === 'upload.ack') {
        void sendChunk(event.index + 1);
      } else if (event.type === 'upload.done') {
        settle(() => resolve(event.attachment));
      } else if (event.type === 'upload.failed') {
        fail(new Error(event.reason));
      }
    }));
    cleanups.push(connection.onStatus((status) => {
      if (status !== 'open') {
        fail(new Error('Connection lost'));
      }
    }));

    if (signal.aborted) {
      fail(new DOMException('Upload cancelled', 'AbortError'));
      return;
    }
    const onAbort = () => {
      connection.send({ type: 'upload.abort', uploadId });
      fail(new DOMException('Upload cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    cleanups.push(() => signal.removeEventListener('abort', onAbort));

    connection.send({ type: 'upload.start', uploadId, conversationId, name: file.name, size: file.size });
  });
}
