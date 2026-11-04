import { UPLOAD_CHUNK_BYTES } from '@agent-remote-control/protocol/limits';

import { FakeServerConnection } from '../../test/fake-server-connection.js';

import { uploadFile } from './upload-file.js';


const attachment = { path: '.arc-uploads/c1/big.bin', name: 'big.bin' };

function setup(file = new File(['x'.repeat(UPLOAD_CHUNK_BYTES + 10)], 'big.bin')) {
  const connection = new FakeServerConnection();
  const controller = new AbortController();
  const result = uploadFile(connection, 'c1', file, controller.signal);
  const sent = (type: string) => connection.sent.filter(command => command.type === type);
  const uploadId = () => {
    const start = connection.sent[0];
    return start.type === 'upload.start' ? start.uploadId : '';
  };
  return { connection, controller, result, sent, uploadId };
}

describe('uploadFile', () => {
  it('announces the file, then sends one chunk per acknowledgement and finishes', async () => {
    const { connection, result, sent, uploadId } = setup();
    expect(connection.sent[0]).toEqual({ type: 'upload.start', uploadId: expect.any(String), conversationId: 'c1', name: 'big.bin', size: UPLOAD_CHUNK_BYTES + 10 });

    connection.emitEvent({ type: 'upload.ready', uploadId: uploadId() });
    await vi.waitFor(() => expect(sent('upload.chunk')).toHaveLength(1));
    expect(sent('upload.chunk')[0]).toMatchObject({ index: 0 });
    expect(sent('upload.finish')).toHaveLength(0);

    connection.emitEvent({ type: 'upload.ack', uploadId: uploadId(), index: 0 });
    await vi.waitFor(() => expect(sent('upload.chunk')).toHaveLength(2));
    expect(sent('upload.chunk')[1]).toMatchObject({ index: 1 });

    connection.emitEvent({ type: 'upload.ack', uploadId: uploadId(), index: 1 });
    await vi.waitFor(() => expect(sent('upload.finish')).toEqual([{ type: 'upload.finish', uploadId: uploadId() }]));

    connection.emitEvent({ type: 'upload.done', uploadId: uploadId(), attachment });
    await expect(result).resolves.toEqual(attachment);
  });

  it('sends the bytes of each chunk as base64', async () => {
    const { connection, sent, uploadId } = setup(new File(['hello'], 'a.txt'));

    connection.emitEvent({ type: 'upload.ready', uploadId: uploadId() });

    await vi.waitFor(() => expect(sent('upload.chunk')).toHaveLength(1));
    expect(sent('upload.chunk')[0]).toMatchObject({ dataBase64: btoa('hello') });
  });

  it('finishes right away for an empty file', async () => {
    const { connection, sent, uploadId } = setup(new File([], 'empty.txt'));

    connection.emitEvent({ type: 'upload.ready', uploadId: uploadId() });

    await vi.waitFor(() => expect(sent('upload.finish')).toHaveLength(1));
    expect(sent('upload.chunk')).toHaveLength(0);
  });

  it('rejects with the reason the server gives', async () => {
    const { connection, result, uploadId } = setup();

    connection.emitEvent({ type: 'upload.failed', uploadId: uploadId(), reason: 'File is too large' });

    await expect(result).rejects.toThrow('File is too large');
  });

  it('ignores events of other uploads and of other kinds', async () => {
    const { connection, result, uploadId } = setup();

    connection.emitEvent({ type: 'upload.failed', uploadId: 'other', reason: 'nope' });
    connection.emitEvent({ type: 'conversation.state', conversationId: 'c1', state: 'idle' });
    connection.emitEvent({ type: 'upload.done', uploadId: uploadId(), attachment });

    await expect(result).resolves.toEqual(attachment);
  });

  it('rejects when the connection stops being open', async () => {
    const { connection, result } = setup();

    connection.emitStatus('closed');

    await expect(result).rejects.toThrow('Connection lost');
  });

  it('tells the server to discard the file when aborted', async () => {
    const { connection, controller, result, sent, uploadId } = setup();

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(sent('upload.abort')).toEqual([{ type: 'upload.abort', uploadId: uploadId() }]);
    expect(connection.sent).toHaveLength(2);
  });

  it('sends nothing when it was aborted before starting', async () => {
    const connection = new FakeServerConnection();
    const controller = new AbortController();
    controller.abort();

    await expect(uploadFile(connection, 'c1', new File(['x'], 'a'), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });

    expect(connection.sent).toEqual([]);
  });

  it('stops listening once settled', async () => {
    const { connection, result, uploadId } = setup();
    connection.emitEvent({ type: 'upload.done', uploadId: uploadId(), attachment });
    await result;

    connection.emitEvent({ type: 'upload.failed', uploadId: uploadId(), reason: 'late' });

    await expect(result).resolves.toEqual(attachment);
  });

  describe('when the file cannot be read', () => {
    afterEach(() => vi.unstubAllGlobals());

    it.each([
      ['with the reader error', new Error('unreadable'), 'unreadable'],
      ['without one', null, 'Could not read the file'],
    ])('aborts the upload and rejects %s', async (_label, readerError, message) => {
      class FailingReader {
        error = readerError;
        onerror: (() => void) | null = null;
        readAsDataURL() {
          queueMicrotask(() => this.onerror?.());
        }
      }
      vi.stubGlobal('FileReader', FailingReader);
      const { connection, result, sent, uploadId } = setup(new File(['x'], 'a'));

      connection.emitEvent({ type: 'upload.ready', uploadId: uploadId() });

      await expect(result).rejects.toThrow(message);
      expect(sent('upload.abort')).toHaveLength(1);
    });

    it('keeps the abort as the outcome when the read fails after it', async () => {
      let failRead: () => void = () => undefined;
      class SlowFailingReader {
        error = new Error('unreadable');
        onerror: (() => void) | null = null;
        readAsDataURL() {
          failRead = () => this.onerror?.();
        }
      }
      vi.stubGlobal('FileReader', SlowFailingReader);
      const { connection, controller, result, sent, uploadId } = setup(new File(['x'], 'a'));
      connection.emitEvent({ type: 'upload.ready', uploadId: uploadId() });

      controller.abort();
      failRead();

      await expect(result).rejects.toMatchObject({ name: 'AbortError' });
      expect(sent('upload.abort')).toHaveLength(2);
    });

    it('rejects with a generic message when the failure is not an Error', async () => {
      class ThrowingReader {
        readAsDataURL() {
          throw 'boom';
        }
      }
      vi.stubGlobal('FileReader', ThrowingReader);
      const { connection, result, uploadId } = setup(new File(['x'], 'a'));

      connection.emitEvent({ type: 'upload.ready', uploadId: uploadId() });

      await expect(result).rejects.toThrow('Could not read the file');
    });
  });
});
