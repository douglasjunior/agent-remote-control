import type { ToHostSignal } from '@agent-remote-control/protocol/signaling';
import { Logger } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { type WebSocket, WebSocketServer } from 'ws';

import type { HostRegistration } from '../ports/signaling-client.port.js';

import { WsSignalingClientAdapter } from './ws-signaling-client.adapter.js';


const NONCE = 'n'.repeat(43);
const registration = (nonce: string): HostRegistration =>
  ({ type: 'host.register', instanceId: '0123456789abcdef0123', certificate: 'cert', signature: `signed:${nonce}`, protocolVersion: 1 });

describe('WsSignalingClientAdapter', () => {
  let server: WebSocketServer;
  let url: string;
  let sockets: WebSocket[];
  let received: unknown[];
  let signals: ToHostSignal[];
  let client: WsSignalingClientAdapter;
  let log: ReturnType<typeof rs.spyOn>;
  let warn: ReturnType<typeof rs.spyOn>;
  let error: ReturnType<typeof rs.spyOn>;

  const connection = async (index: number) => {
    await rs.waitFor(() => expect(sockets.length).toBeGreaterThan(index));
    return sockets[index]!;
  };
  let onSignal: (signal: ToHostSignal) => void;
  let register: (nonce: string) => Promise<HostRegistration>;
  const start = () => client.start({ url, register: nonce => register(nonce), onSignal: signal => onSignal(signal) });

  beforeEach(async () => {
    log = rs.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = rs.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    sockets = [];
    received = [];
    signals = [];
    onSignal = signal => signals.push(signal);
    register = nonce => Promise.resolve(registration(nonce));
    server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    server.on('connection', (socket) => {
      sockets.push(socket);
      socket.send(JSON.stringify({ type: 'host.challenge', nonce: NONCE }));
      socket.on('message', data => received.push(JSON.parse(String(data))));
    });
    await new Promise(done => server.once('listening', done));
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/signal/host`;
    client = new WsSignalingClientAdapter();
  });

  afterEach(async () => {
    client.onModuleDestroy();
    rs.useRealTimers();
    rs.restoreAllMocks();
    await new Promise(done => server.close(done));
  });

  it('should answer the challenge with the registration and hand the signals it receives', async () => {
    start();
    const socket = await connection(0);
    await rs.waitFor(() => expect(received).toEqual([registration(NONCE)]));

    socket.send('{"type":"host.registered"}');
    socket.send('{"type":"unknown"}');
    socket.send('{"type":"session.closed","sessionId":"00000000-0000-4000-8000-000000000001"}');
    await rs.waitFor(() => expect(signals).toHaveLength(2));

    expect(signals).toEqual([{ type: 'host.registered' }, { type: 'session.closed', sessionId: '00000000-0000-4000-8000-000000000001' }]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^Remote access ready through 127\.0\.0\.1:\d+$/));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('signal_dropped'));
  });

  it('should send signals only while connected', async () => {
    client.send({ type: 'host.close', sessionId: '00000000-0000-4000-8000-000000000001' });
    start();
    await connection(0);
    await rs.waitFor(() => expect(received).toHaveLength(1));
    client.send({ type: 'host.close', sessionId: '00000000-0000-4000-8000-000000000001' });

    await rs.waitFor(() => expect(received).toHaveLength(2));
    expect(received[1]).toEqual({ type: 'host.close', sessionId: '00000000-0000-4000-8000-000000000001' });
  });

  it('should reconnect with backoff, warning once while the server is unreachable', async () => {
    rs.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    start();
    (await connection(0)).close();
    await rs.waitFor(() => expect(warn).toHaveBeenCalledOnce());
    rs.advanceTimersByTime(1_000);
    (await connection(1)).close(1011);
    await rs.waitFor(() => expect(sockets[1]!.readyState).toBe(3));
    await new Promise(done => setImmediate(done));
    rs.advanceTimersByTime(2_000);
    const third = await connection(2);
    third.send('{"type":"host.registered"}');
    await rs.waitFor(() => expect(signals).toHaveLength(1));

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(`Remote access unavailable: cannot reach ${url}, retrying`);
  });

  it('should drop a socket that stays quiet and reconnect', async () => {
    rs.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    start();
    const first = await connection(0);
    await rs.waitFor(() => expect(received).toHaveLength(1));
    first.ping();
    await new Promise(done => setImmediate(done));
    rs.advanceTimersByTime(70_000);
    await new Promise(done => first.once('close', done));
    rs.advanceTimersByTime(1_000);

    expect(await connection(1)).toBeDefined();
  });

  it('should log a registration that fails and a signal its handler cannot take, and keep going', async () => {
    register = () => Promise.reject(new Error('no key'));
    onSignal = () => {
      throw new Error('boom');
    };
    start();
    const socket = await connection(0);
    await rs.waitFor(() => expect(error).toHaveBeenCalledWith('signal_registration_failed: no key'));
    socket.send('{"type":"session.closed","sessionId":"00000000-0000-4000-8000-000000000001"}');
    await rs.waitFor(() => expect(error).toHaveBeenCalledWith('signal_handler_failed: session.closed: boom'));
    register = () => Promise.reject('plain');
    socket.send(JSON.stringify({ type: 'host.challenge', nonce: NONCE }));
    await rs.waitFor(() => expect(error).toHaveBeenCalledWith('signal_registration_failed: plain'));

    expect(socket.readyState).toBe(1);
  });

  it.each([
    [4400, 'Remote access refused: the signaling server did not accept the registration of this instance'],
    [4403, 'Remote access refused: the signaling server does not serve this instance'],
    [4409, 'Remote access stopped: another server registered the same instance (same DATA_DIR)'],
  ])('should stop reconnecting after the close code %i', async (code, message) => {
    rs.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    start();
    (await connection(0)).close(code);
    await rs.waitFor(() => expect(error).toHaveBeenCalledWith(message));
    rs.advanceTimersByTime(120_000);
    await new Promise(done => setImmediate(done));

    expect(sockets).toHaveLength(1);
  });

  it('should not reconnect after stopping', async () => {
    rs.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    start();
    await connection(0);
    client.stop();
    rs.advanceTimersByTime(120_000);
    await new Promise(done => setImmediate(done));

    expect(sockets).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
