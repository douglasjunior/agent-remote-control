import type { ClientCommand } from '@agent-remote-control/protocol/client-command';
import { BYTES_PER_MB, MAX_ATTACHMENTS, MAX_UPLOAD_MB, UPLOAD_CHUNK_BYTES } from '@agent-remote-control/protocol/limits';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { UploadLimits } from '../../connection/connection-context.js';
import { FakeServerConnection } from '../../test/fake-server-connection.js';


import { usePromptAttachments } from './use-prompt-attachments.js';


/** Answers the upload protocol like the server does, unless told to hold back or to refuse. */
class UploadingConnection extends FakeServerConnection {
  hold = false;
  refuseWith: string | null = null;
  private readonly names = new Map<string, string>();

  override send(command: ClientCommand): void {
    super.send(command);
    if (this.hold) {
      return;
    }
    queueMicrotask(() => this.reply(command));
  }

  private reply(command: ClientCommand): void {
    if (command.type === 'upload.start') {
      this.names.set(command.uploadId, command.name);
      this.emitEvent(this.refuseWith === null
        ? { type: 'upload.ready', uploadId: command.uploadId }
        : { type: 'upload.failed', uploadId: command.uploadId, reason: this.refuseWith });
    } else if (command.type === 'upload.chunk') {
      this.emitEvent({ type: 'upload.ack', uploadId: command.uploadId, index: command.index });
    } else if (command.type === 'upload.finish') {
      const name = this.names.get(command.uploadId) ?? '';
      this.emitEvent({ type: 'upload.done', uploadId: command.uploadId, attachment: { path: `.arc-uploads/c1/${name}`, name } });
    }
  }
}

type Api = ReturnType<typeof usePromptAttachments>;

const LIMITS: UploadLimits = { maxBytes: 2.5 * BYTES_PER_MB, maxAttachments: 4 };

function setup(conversationId: string | null = 'c1', limits: UploadLimits | null = LIMITS) {
  const connection = new UploadingConnection();
  const api: { current: Api } = { current: undefined as unknown as Api };
  function Harness() {
    api.current = usePromptAttachments(connection, conversationId, limits);
    return (
      <div data-testid="drop" {...api.current.dropHandlers} onPaste={api.current.onPaste}>
        {api.current.items.map(item => <span key={item.id}>{`${item.name}:${item.status}${item.error ? `:${item.error}` : ''}`}</span>)}
      </div>
    );
  }
  const view = render(<Harness />);
  const add = (...files: File[]) => act(async () => api.current.addFiles(files));
  const settle = () => waitFor(() => expect(api.current.uploading).toBe(false));
  const sent = (type: string) => connection.sent.filter(command => command.type === type);
  return { connection, api, view, add, settle, sent };
}

const file = (name: string, content = 'data') => new File([content], name);
const dragData = (types: string[] = ['Files'], files: File[] = []) => ({ dataTransfer: { types, files } });

describe('usePromptAttachments', () => {
  it('should ignore added files and report itself disabled without a conversation', async () => {
    const { connection, api, add } = setup(null);

    await add(file('a.txt'));

    expect(api.current.enabled).toBe(false);
    expect(api.current.items).toEqual([]);
    expect(connection.sent).toEqual([]);
  });

  it('should upload each added file and expose the stored attachments', async () => {
    const { api, add, settle } = setup();

    await add(file('a.txt'), file('b.txt'));
    await settle();

    expect(screen.getByText('a.txt:ready')).toBeInTheDocument();
    expect(api.current.ready).toEqual([
      { path: '.arc-uploads/c1/a.txt', name: 'a.txt' },
      { path: '.arc-uploads/c1/b.txt', name: 'b.txt' },
    ]);
  });

  it('should be uploading until the server confirms', async () => {
    const { connection, api, add, settle } = setup();
    connection.hold = true;

    await add(file('a.txt'));
    expect(api.current.uploading).toBe(true);
    expect(api.current.ready).toEqual([]);

    connection.hold = false;
    const start = connection.sent[0];
    act(() => connection.emitEvent({ type: 'upload.ready', uploadId: start.type === 'upload.start' ? start.uploadId : '' }));
    await settle();

    expect(api.current.ready).toHaveLength(1);
  });

  it('should mark a file above the limit as failed without sending anything', async () => {
    const { connection, api, add } = setup();
    const big = file('big.bin');
    Object.defineProperty(big, 'size', { value: LIMITS.maxBytes + 1 });

    await add(big);

    expect(screen.getByText('big.bin:error:File is larger than 2.5 MB')).toBeInTheDocument();
    expect(connection.sent).toEqual([]);
    expect(api.current.uploading).toBe(false);
  });

  it('should bound the files by the protocol until the server tells its limits', async () => {
    const { connection, api, add, settle } = setup('c1', null);
    const big = file('big.bin');
    Object.defineProperty(big, 'size', { value: MAX_UPLOAD_MB * BYTES_PER_MB + 1 });

    await add(big);
    expect(screen.getByText(`big.bin:error:File is larger than ${MAX_UPLOAD_MB} MB`)).toBeInTheDocument();
    expect(connection.sent).toEqual([]);
    await add(...Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, index) => file(`f${index}.txt`)));
    await settle();

    expect(api.current.items).toHaveLength(MAX_ATTACHMENTS);
  });

  it('should mark a file as failed with the reason the server gives', async () => {
    const { connection, add, settle } = setup();
    connection.refuseWith = 'Too many uploads in progress';

    await add(file('a.txt'));
    await settle();

    expect(screen.getByText('a.txt:error:Too many uploads in progress')).toBeInTheDocument();
  });

  it('should keep a failed file out of the attachments that are sent', async () => {
    const { connection, api, add, settle } = setup();
    await add(file('good.txt'));
    await settle();
    connection.refuseWith = 'nope';
    await add(file('bad.txt'));
    await settle();

    expect(api.current.ready.map(attachment => attachment.name)).toEqual(['good.txt']);
  });

  it('should take no more than the attachment limit', async () => {
    const { api, add, settle } = setup();

    await add(...Array.from({ length: LIMITS.maxAttachments + 3 }, (_, index) => file(`f${index}.txt`)));
    await settle();

    expect(api.current.items).toHaveLength(LIMITS.maxAttachments);
  });

  it('should cancel a running upload on remove and free its slot', async () => {
    const { connection, api, add, sent } = setup();
    connection.hold = true;
    await add(file('a.txt'));
    const id = api.current.items[0].id;

    act(() => api.current.remove(id));

    expect(api.current.items).toEqual([]);
    expect(sent('upload.abort')).toHaveLength(1);
    await add(...Array.from({ length: LIMITS.maxAttachments }, (_, index) => file(`f${index}.txt`)));
    expect(api.current.items).toHaveLength(LIMITS.maxAttachments);
  });

  it('should remove a finished file without telling the server', async () => {
    const { api, add, settle, sent } = setup();
    await add(file('a.txt'));
    await settle();

    act(() => api.current.remove(api.current.items[0].id));

    expect(api.current.items).toEqual([]);
    expect(sent('upload.abort')).toHaveLength(0);
  });

  it('should clear the list and free every slot', async () => {
    const { api, add, settle } = setup();
    await add(...Array.from({ length: LIMITS.maxAttachments }, (_, index) => file(`f${index}.txt`)));
    await settle();

    act(() => api.current.clear());
    await add(file('again.txt'));

    expect(api.current.items.map(item => item.name)).toEqual(['again.txt']);
  });

  it('should cancel the uploads still running when it unmounts', async () => {
    const { connection, add, view, sent } = setup();
    connection.hold = true;
    await add(file('a.txt'));

    view.unmount();

    expect(sent('upload.abort')).toHaveLength(1);
  });

  describe('the upload protocol', () => {
    const stored = { path: '.arc-uploads/c1/big.bin', name: 'big.bin' };

    /** Holds the server back, so each event of the upload is emitted by the test. */
    async function startUpload(content: File = new File(['x'.repeat(UPLOAD_CHUNK_BYTES + 10)], 'big.bin')) {
      const context = setup();
      context.connection.hold = true;
      await context.add(content);
      const start = context.connection.sent[0];
      const uploadId = start?.type === 'upload.start' ? start.uploadId : '';
      return { ...context, uploadId };
    }

    it('should announce the file, then send one chunk per acknowledgement and finish', async () => {
      const { connection, api, sent, uploadId } = await startUpload();
      expect(connection.sent[0]).toEqual({ type: 'upload.start', uploadId: expect.any(String), conversationId: 'c1', name: 'big.bin', size: UPLOAD_CHUNK_BYTES + 10 });

      connection.emitEvent({ type: 'upload.ready', uploadId });
      await waitFor(() => expect(sent('upload.chunk')).toHaveLength(1));
      expect(sent('upload.chunk')[0]).toMatchObject({ index: 0 });
      expect(sent('upload.finish')).toHaveLength(0);

      connection.emitEvent({ type: 'upload.ack', uploadId, index: 0 });
      await waitFor(() => expect(sent('upload.chunk')).toHaveLength(2));
      expect(sent('upload.chunk')[1]).toMatchObject({ index: 1 });

      connection.emitEvent({ type: 'upload.ack', uploadId, index: 1 });
      await waitFor(() => expect(sent('upload.finish')).toEqual([{ type: 'upload.finish', uploadId }]));

      act(() => connection.emitEvent({ type: 'upload.done', uploadId, attachment: stored }));
      await waitFor(() => expect(api.current.items[0]).toMatchObject({ status: 'ready', attachment: stored }));
    });

    it('should send the bytes of each chunk as base64', async () => {
      const { connection, sent, uploadId } = await startUpload(new File(['hello'], 'a.txt'));

      connection.emitEvent({ type: 'upload.ready', uploadId });

      await waitFor(() => expect(sent('upload.chunk')).toHaveLength(1));
      expect(sent('upload.chunk')[0]).toMatchObject({ dataBase64: btoa('hello') });
    });

    it('should finish right away for an empty file', async () => {
      const { connection, sent, uploadId } = await startUpload(new File([], 'empty.txt'));

      connection.emitEvent({ type: 'upload.ready', uploadId });

      await waitFor(() => expect(sent('upload.finish')).toHaveLength(1));
      expect(sent('upload.chunk')).toHaveLength(0);
    });

    it('should ignore events of other uploads and of other kinds', async () => {
      const { connection, api, uploadId } = await startUpload();

      act(() => {
        connection.emitEvent({ type: 'upload.failed', uploadId: 'other', reason: 'nope' });
        connection.emitEvent({ type: 'conversation.state', conversationId: 'c1', state: 'idle' });
        connection.emitEvent({ type: 'upload.done', uploadId, attachment: stored });
      });

      await waitFor(() => expect(api.current.items[0]).toMatchObject({ status: 'ready' }));
    });

    it('should fail when the connection stops being open', async () => {
      const { connection, api } = await startUpload();

      act(() => connection.emitStatus('closed'));

      await waitFor(() => expect(api.current.items[0]).toMatchObject({ status: 'error', error: 'Connection lost' }));
    });

    it('should stop listening once settled', async () => {
      const { connection, api, uploadId } = await startUpload();
      act(() => connection.emitEvent({ type: 'upload.done', uploadId, attachment: stored }));
      await waitFor(() => expect(api.current.items[0]).toMatchObject({ status: 'ready' }));

      act(() => connection.emitEvent({ type: 'upload.failed', uploadId, reason: 'late' }));

      expect(api.current.items[0]).toMatchObject({ status: 'ready' });
    });

    describe('when the file cannot be read', () => {
      afterEach(() => {
        rs.unstubAllGlobals();
      });

      it.each([
        ['with the reader error', new Error('unreadable'), 'unreadable'],
        ['without one', null, 'Could not read the file'],
      ])('should abort the upload and fail %s', async (_label, readerError, message) => {
        class FailingReader {
          error = readerError;
          onerror: (() => void) | null = null;
          readAsDataURL() {
            queueMicrotask(() => this.onerror?.());
          }
        }
        rs.stubGlobal('FileReader', FailingReader);
        const { connection, api, sent, uploadId } = await startUpload(new File(['x'], 'a'));

        connection.emitEvent({ type: 'upload.ready', uploadId });

        await waitFor(() => expect(api.current.items[0]).toMatchObject({ status: 'error', error: message }));
        expect(sent('upload.abort')).toHaveLength(1);
      });

      it('should keep the abort as the outcome when the read fails after it', async () => {
        let failRead: () => void = () => undefined;
        class SlowFailingReader {
          error = new Error('unreadable');
          onerror: (() => void) | null = null;
          readAsDataURL() {
            failRead = () => this.onerror?.();
          }
        }
        rs.stubGlobal('FileReader', SlowFailingReader);
        const { connection, api, sent, uploadId } = await startUpload(new File(['x'], 'a'));
        connection.emitEvent({ type: 'upload.ready', uploadId });

        act(() => api.current.remove(api.current.items[0].id));
        failRead();

        await waitFor(() => expect(sent('upload.abort')).toHaveLength(2));
        expect(api.current.items).toEqual([]);
      });

      it('should fail with a generic message when the failure is not an Error', async () => {
        class ThrowingReader {
          readAsDataURL() {
            throw 'boom';
          }
        }
        rs.stubGlobal('FileReader', ThrowingReader);
        const { connection, api, uploadId } = await startUpload(new File(['x'], 'a'));

        connection.emitEvent({ type: 'upload.ready', uploadId });

        await waitFor(() => expect(api.current.items[0]).toMatchObject({ status: 'error', error: 'Could not read the file' }));
      });
    });
  });

  describe('drag and drop', () => {
    it('should show the drop state while files are dragged over, and end it when they leave', () => {
      const { api } = setup();
      const zone = screen.getByTestId('drop');

      fireEvent.dragEnter(zone, dragData());
      fireEvent.dragEnter(zone, dragData());
      expect(api.current.dragging).toBe(true);

      fireEvent.dragLeave(zone, dragData());
      expect(api.current.dragging).toBe(true);
      fireEvent.dragLeave(zone, dragData());
      expect(api.current.dragging).toBe(false);
    });

    it('should allow the drop of files, and ignore drags of text', () => {
      const { api } = setup();
      const zone = screen.getByTestId('drop');

      expect(fireEvent.dragOver(zone, dragData())).toBe(false);
      expect(fireEvent.dragOver(zone, dragData(['text/plain']))).toBe(true);
      fireEvent.dragEnter(zone, dragData(['text/plain']));
      fireEvent.dragLeave(zone, dragData(['text/plain']));
      fireEvent.drop(zone, dragData(['text/plain']));

      expect(api.current.dragging).toBe(false);
      expect(api.current.items).toEqual([]);
    });

    it('should attach the dropped files and end the drop state', async () => {
      const { api, settle } = setup();
      const zone = screen.getByTestId('drop');
      fireEvent.dragEnter(zone, dragData());

      fireEvent.drop(zone, dragData(['Files'], [file('dropped.txt')]));
      await settle();

      expect(api.current.dragging).toBe(false);
      expect(api.current.ready.map(attachment => attachment.name)).toEqual(['dropped.txt']);
    });
  });

  describe('paste', () => {
    it('should attach pasted files instead of pasting them as text', async () => {
      const { api, settle } = setup();

      const notPrevented = fireEvent.paste(screen.getByTestId('drop'), { clipboardData: { files: [file('image.png')] } });
      await settle();

      expect(notPrevented).toBe(false);
      expect(api.current.ready.map(attachment => attachment.name)).toEqual(['image.png']);
    });

    it('should leave a text paste alone', () => {
      const { api } = setup();

      const notPrevented = fireEvent.paste(screen.getByTestId('drop'), { clipboardData: { files: [] } });

      expect(notPrevented).toBe(true);
      expect(api.current.items).toEqual([]);
    });
  });
});
