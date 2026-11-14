import type { ToHostSignal } from '@agent-remote-control/protocol/signaling';
import { Logger } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { type WebSocket, WebSocketServer } from 'ws';

import type { HostRegistration } from '../ports/signaling-client.port.js';

import { WsSignalingClientAdapter } from './ws-signaling-client.adapter.js';


const registration: HostRegistration = { type: 'host.register', instanceId: '0123456789abcdef0123', secret: 's', protocolVersion: 1 };

describe('WsSignalingClientAdapter', () => {
  let server: WebSocketServer;
  let url: string;
  let sockets: WebSocket[];
  let received: unknown[];
  let signals: ToHostSignal[];
  let client: WsSignalingClientAdapter;
  let log: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  const connection = async (index: number) => {
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(index));
    return sockets[index]!;
  };
  const start = () => client.start({ url, registration, onSignal: signal => signals.push(signal) });

  beforeEach(async () => {
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    sockets = [];
    received = [];
    signals = [];
    server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    server.on('connection', (socket) => {
      sockets.push(socket);
      socket.on('message', data => received.push(JSON.parse(String(data))));
    });
    await new Promise(done => server.once('listening', done));
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/signal/host`;
    client = new WsSignalingClientAdapter();
  });

  afterEach(async () => {
    client.onModuleDestroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
    await new Promise(done => server.close(done));
  });

  it('should register on connecting and hand the signals it receives', async () => {
    start();
    const socket = await connection(0);
    await vi.waitFor(() => expect(received).toEqual([registration]));

    socket.send('{"type":"host.registered"}');
    socket.send('{"type":"unknown"}');
    socket.send('{"type":"session.closed","sessionId":"00000000-0000-4000-8000-000000000001"}');
    await vi.waitFor(() => expect(signals).toHaveLength(2));

    expect(signals).toEqual([{ type: 'host.registered' }, { type: 'session.closed', sessionId: '00000000-0000-4000-8000-000000000001' }]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^Remote access ready through 127\.0\.0\.1:\d+$/));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('signal_dropped'));
  });

  it('should send signals only while connected', async () => {
    client.send({ type: 'host.close', sessionId: '00000000-0000-4000-8000-000000000001' });
    start();
    await connection(0);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    client.send({ type: 'host.close', sessionId: '00000000-0000-4000-8000-000000000001' });

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received[1]).toEqual({ type: 'host.close', sessionId: '00000000-0000-4000-8000-000000000001' });
  });

  it('should reconnect with backoff, warning once while the server is unreachable', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    start();
    (await connection(0)).close();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
    vi.advanceTimersByTime(1_000);
    (await connection(1)).close(1011);
    await vi.waitFor(() => expect(sockets[1]!.readyState).toBe(3));
    await new Promise(done => setImmediate(done));
    vi.advanceTimersByTime(2_000);
    const third = await connection(2);
    third.send('{"type":"host.registered"}');
    await vi.waitFor(() => expect(signals).toHaveLength(1));

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(`Remote access unavailable: cannot reach ${url}, retrying`);
  });

  it('should drop a socket that stays quiet and reconnect', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    start();
    const first = await connection(0);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    first.ping();
    await new Promise(done => setImmediate(done));
    vi.advanceTimersByTime(70_000);
    await new Promise(done => first.once('close', done));
    vi.advanceTimersByTime(1_000);

    expect(await connection(1)).toBeDefined();
  });

  it.each([
    [4400, 'Remote access refused: the signaling server did not accept this instance'],
    [4409, 'Remote access stopped: another server registered the same instance (same DATA_DIR)'],
  ])('should stop reconnecting after the close code %i', async (code, message) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    start();
    (await connection(0)).close(code);
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(message));
    vi.advanceTimersByTime(120_000);
    await new Promise(done => setImmediate(done));

    expect(sockets).toHaveLength(1);
  });

  it('should not reconnect after stopping', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    start();
    await connection(0);
    client.stop();
    vi.advanceTimersByTime(120_000);
    await new Promise(done => setImmediate(done));

    expect(sockets).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
