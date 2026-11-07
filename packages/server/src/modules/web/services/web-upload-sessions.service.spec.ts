import { MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from '@agent-remote-control/protocol/limits';

import { FakeClientConnection } from '../testing/fake-client-connection.js';
import { FakeWorkspaceUpload } from '../testing/fake-workspace-upload.js';

import { MAX_CONCURRENT_UPLOADS, UPLOAD_IDLE_TIMEOUT_MS, WebUploadSessionsService } from './web-upload-sessions.service.js';


const base64 = (text: string) => Buffer.from(text).toString('base64');

function setup() {
  const files = new FakeWorkspaceUpload();
  const service = new WebUploadSessionsService(files);
  const connection = new FakeClientConnection('c1');
  const start = (uploadId = 'u1', size = 11, name = 'notes.txt') =>
    service.start(connection, { uploadId, conversationId: 'web-1', name, size });
  const last = () => connection.sent.at(-1);
  return { files, service, connection, start, last };
}

describe('WebUploadSessionsService', () => {
  afterEach(() => vi.useRealTimers());

  it('opens a writer in the conversation upload directory and answers upload.ready', async () => {
    const { start, files, last } = setup();

    await start();

    expect(files.writers[0]).toMatchObject({ directory: '.arc-uploads/web-1', name: 'notes.txt' });
    expect(last()).toEqual({ type: 'upload.ready', uploadId: 'u1' });
  });

  it('assembles ordered chunks, acknowledges each one and answers upload.done with the stored path', async () => {
    const { service, connection, start, files } = setup();
    await start();

    await service.chunk(connection, { uploadId: 'u1', index: 0, dataBase64: base64('hello ') });
    await service.chunk(connection, { uploadId: 'u1', index: 1, dataBase64: base64('world') });
    await service.finish(connection, 'u1');

    expect(connection.sent.slice(1)).toEqual([
      { type: 'upload.ack', uploadId: 'u1', index: 0 },
      { type: 'upload.ack', uploadId: 'u1', index: 1 },
      { type: 'upload.done', uploadId: 'u1', attachment: { path: '.arc-uploads/web-1/notes.txt', name: 'notes.txt' } },
    ]);
    expect(files.writers[0].text).toBe('hello world');
    expect(files.writers[0].committed).toBe(true);
  });

  it('accepts an empty file', async () => {
    const { service, connection, start, last } = setup();
    await start('u1', 0);

    await service.finish(connection, 'u1');

    expect(last()).toMatchObject({ type: 'upload.done' });
  });

  it('refuses a file above the limit', async () => {
    const { start, last, files } = setup();

    await start('u1', MAX_UPLOAD_BYTES + 1);

    expect(last()).toEqual({ type: 'upload.failed', uploadId: 'u1', reason: 'File is too large' });
    expect(files.writers).toHaveLength(0);
  });

  it('refuses an id that is already in use without touching the running upload', async () => {
    const { start, last, files } = setup();
    await start();

    await start();

    expect(last()).toEqual({ type: 'upload.failed', uploadId: 'u1', reason: 'Upload id already in use' });
    expect(files.writers[0].aborted).toBe(false);
  });

  it('limits the uploads in progress per connection, not per server', async () => {
    const { service, connection, start, last } = setup();
    for (let index = 0; index < MAX_CONCURRENT_UPLOADS; index += 1) {
      await start(`u${index}`);
    }

    await start('extra');
    expect(last()).toEqual({ type: 'upload.failed', uploadId: 'extra', reason: 'Too many uploads in progress' });

    const other = new FakeClientConnection('c2');
    await service.start(other, { uploadId: 'extra', conversationId: 'web-1', name: 'a', size: 1 });
    expect(other.sent.at(-1)).toEqual({ type: 'upload.ready', uploadId: 'extra' });
    expect(connection.sent.at(-1)).toMatchObject({ reason: 'Too many uploads in progress' });
  });

  it('discards the upload on a chunk that arrives out of order', async () => {
    const { service, connection, start, files, last } = setup();
    await start();

    await service.chunk(connection, { uploadId: 'u1', index: 1, dataBase64: base64('x') });

    expect(last()).toEqual({ type: 'upload.failed', uploadId: 'u1', reason: 'Chunk out of order' });
    expect(files.writers[0].aborted).toBe(true);
  });

  it('discards the upload on a chunk that goes past the announced size', async () => {
    const { service, connection, start, files, last } = setup();
    await start('u1', 11);

    await service.chunk(connection, { uploadId: 'u1', index: 0, dataBase64: base64('x'.repeat(12)) });

    expect(last()).toEqual({ type: 'upload.failed', uploadId: 'u1', reason: 'Chunk exceeds the announced size' });
    expect(files.writers[0].aborted).toBe(true);
  });

  it('discards the upload on a chunk above the chunk limit', async () => {
    const { service, connection, start, last } = setup();
    await start('u1', MAX_UPLOAD_BYTES);

    await service.chunk(connection, { uploadId: 'u1', index: 0, dataBase64: base64('x'.repeat(UPLOAD_CHUNK_BYTES + 1)) });

    expect(last()).toEqual({ type: 'upload.failed', uploadId: 'u1', reason: 'Chunk exceeds the announced size' });
  });

  it('refuses to finish an incomplete file and discards it', async () => {
    const { service, connection, start, files, last } = setup();
    await start();
    await service.chunk(connection, { uploadId: 'u1', index: 0, dataBase64: base64('short') });

    await service.finish(connection, 'u1');

    expect(last()).toEqual({ type: 'upload.failed', uploadId: 'u1', reason: 'File is incomplete' });
    expect(files.writers[0].aborted).toBe(true);
    expect(files.writers[0].committed).toBe(false);
  });

  it('answers upload.failed for an unknown upload', async () => {
    const { service, connection, last } = setup();

    await service.chunk(connection, { uploadId: 'ghost', index: 0, dataBase64: '' });
    expect(last()).toEqual({ type: 'upload.failed', uploadId: 'ghost', reason: 'Unknown upload' });

    await service.finish(connection, 'ghost');
    expect(last()).toEqual({ type: 'upload.failed', uploadId: 'ghost', reason: 'Unknown upload' });
  });

  it('reports a write failure and discards the upload', async () => {
    const { service, connection, start, files, last } = setup();
    await start();
    vi.spyOn(files.writers[0], 'append').mockRejectedValueOnce(new Error('disk full'));

    await service.chunk(connection, { uploadId: 'u1', index: 0, dataBase64: base64('data') });

    expect(last()).toEqual({ type: 'upload.failed', uploadId: 'u1', reason: 'disk full' });
    expect(files.writers[0].aborted).toBe(true);
  });

  it('reports a failure that carries no message', async () => {
    const { service, connection, start, files, last } = setup();
    await start();
    vi.spyOn(files.writers[0], 'append').mockRejectedValueOnce('boom');

    await service.chunk(connection, { uploadId: 'u1', index: 0, dataBase64: base64('data') });

    expect(last()).toEqual({ type: 'upload.failed', uploadId: 'u1', reason: 'Upload failed' });
  });

  it('discards the partial file on abort, and ignores an unknown id', async () => {
    const { service, connection, start, files } = setup();
    await start();

    await service.abort('c1', 'ghost');
    await service.abort(connection.id, 'u1');

    expect(files.writers[0].aborted).toBe(true);
  });

  it('drops every upload of a connection that went away and keeps the others', async () => {
    const { service, start, files } = setup();
    await start('u1');
    const other = new FakeClientConnection('c2');
    await service.start(other, { uploadId: 'u9', conversationId: 'web-1', name: 'b', size: 1 });

    await service.releaseConnection('c1');

    expect(files.writers.map(writer => writer.aborted)).toEqual([true, false]);
  });

  it('fails an upload that stays silent, and keeps one that keeps sending', async () => {
    vi.useFakeTimers();
    const { service, connection, start, files, last } = setup();
    await start('u1', 100);
    await vi.advanceTimersByTimeAsync(UPLOAD_IDLE_TIMEOUT_MS - 1);
    await service.chunk(connection, { uploadId: 'u1', index: 0, dataBase64: base64('x') });

    await vi.advanceTimersByTimeAsync(UPLOAD_IDLE_TIMEOUT_MS - 1);
    expect(files.writers[0].aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(files.writers[0].aborted).toBe(true);
    expect(last()).toEqual({ type: 'upload.failed', uploadId: 'u1', reason: 'Upload timed out' });
  });

  it('does not time out an upload that finished', async () => {
    vi.useFakeTimers();
    const { service, connection, start, files } = setup();
    await start('u1', 0);
    await service.finish(connection, 'u1');

    await vi.advanceTimersByTimeAsync(UPLOAD_IDLE_TIMEOUT_MS * 2);

    expect(files.writers[0].aborted).toBe(false);
  });
});
