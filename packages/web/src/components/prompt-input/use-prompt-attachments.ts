import type { Attachment } from '@agent-remote-control/protocol/attachment';
import { MAX_ATTACHMENTS, MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from '@agent-remote-control/protocol/limits';
import type { ClipboardEvent, DragEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { IServerConnection } from '../../connection/server-connection.js';


export type AttachmentItem = {
  readonly id: string;
  readonly name: string;
  readonly status: 'uploading' | 'ready' | 'error';
  readonly attachment?: Attachment;
  readonly error?: string;
};

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
function uploadFile(
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

    const onAbort = () => {
      connection.send({ type: 'upload.abort', uploadId });
      fail(new DOMException('Upload cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    cleanups.push(() => signal.removeEventListener('abort', onAbort));

    connection.send({ type: 'upload.start', uploadId, conversationId, name: file.name, size: file.size });
  });
}

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

/**
 * Files attached to the message being written. Each file uploads as soon as it is added (picked,
 * dropped on the frame or pasted); the message may be sent once none is still uploading, and carries
 * the ones that are `ready`. Leaving the conversation cancels the uploads still running.
 */
export function usePromptAttachments(connection: IServerConnection, conversationId: string) {
  const [items, setItems] = useState<readonly AttachmentItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const running = useRef(new Map<string, AbortController>());
  const dragDepth = useRef(0);
  const count = useRef(0);

  useEffect(() => {
    const controllers = running.current;
    return () => controllers.forEach(controller => controller.abort());
  }, []);

  const update = useCallback((id: string, changes: Partial<AttachmentItem>) => {
    setItems(current => current.map(item => (item.id === id ? { ...item, ...changes } : item)));
  }, []);

  const start = useCallback((id: string, file: File) => {
    const controller = new AbortController();
    running.current.set(id, controller);
    uploadFile(connection, conversationId, file, controller.signal)
      .then(attachment => update(id, { status: 'ready', attachment }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          update(id, { status: 'error', error: error instanceof Error ? error.message : 'Upload failed' });
        }
      })
      .finally(() => running.current.delete(id));
  }, [connection, conversationId, update]);

  const addFiles = useCallback((files: readonly File[]) => {
    const accepted = files.slice(0, Math.max(0, MAX_ATTACHMENTS - count.current));
    count.current += accepted.length;
    const added = accepted.map((file) => {
      const tooLarge = file.size > MAX_UPLOAD_BYTES;
      const item: AttachmentItem = {
        id: crypto.randomUUID(),
        name: file.name,
        status: tooLarge ? 'error' : 'uploading',
        ...(tooLarge && { error: 'File is too large' }),
      };
      return { item, file };
    });
    setItems(current => [...current, ...added.map(({ item }) => item)]);
    added.filter(({ item }) => item.status === 'uploading').forEach(({ item, file }) => start(item.id, file));
  }, [start]);

  const remove = useCallback((id: string) => {
    running.current.get(id)?.abort();
    running.current.delete(id);
    count.current = Math.max(0, count.current - 1);
    setItems(current => current.filter(item => item.id !== id));
  }, []);

  const clear = useCallback(() => {
    running.current.forEach(controller => controller.abort());
    running.current.clear();
    count.current = 0;
    setItems([]);
  }, []);

  const dropHandlers = {
    onDragEnter: (event: DragEvent) => {
      if (hasFiles(event)) {
        dragDepth.current += 1;
        setDragging(true);
      }
    },
    onDragOver: (event: DragEvent) => {
      if (hasFiles(event)) {
        event.preventDefault();
      }
    },
    onDragLeave: (event: DragEvent) => {
      if (hasFiles(event)) {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        setDragging(dragDepth.current > 0);
      }
    },
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      addFiles([...event.dataTransfer.files]);
    },
  };

  const onPaste = (event: ClipboardEvent) => {
    const files = [...event.clipboardData.files];
    if (files.length > 0) {
      event.preventDefault();
      addFiles(files);
    }
  };

  return {
    items,
    uploading: items.some(item => item.status === 'uploading'),
    ready: items.flatMap(item => (item.attachment ? [item.attachment] : [])),
    addFiles,
    remove,
    clear,
    dragging,
    dropHandlers,
    onPaste,
  };
}
