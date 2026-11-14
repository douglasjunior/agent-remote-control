import type { ToClientSignal, ToHostSignal } from '@agent-remote-control/protocol/signaling';
import { Logger } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';

import type { ISignalingSocket } from '../ports/signaling-transport.port.js';

import { WsSignalingTransportAdapter } from './ws-signaling-transport.adapter.js';


describe('WsSignalingTransportAdapter', () => {
  let httpServer: Server;
  let adapter: WsSignalingTransportAdapter;
  let port: number;
  let hosts: ISignalingSocket<ToHostSignal>[];
  let clients: ISignalingSocket<ToClientSignal>[];
  const sockets: WebSocket[] = [];

  const open = (path: string, origin?: string, forwardedFor?: string) => {
    const headers = { ...origin ? { origin } : {}, ...forwardedFor ? { 'x-forwarded-for': forwardedFor } : {} };
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
    sockets.push(socket);
    return socket;
  };
  const closed = (socket: WebSocket) => new Promise<number>(done => socket.once('close', code => done(code)));
  const outcome = (socket: WebSocket) =>
    new Promise<string>((done) => {
      socket.once('open', () => done('open'));
      socket.once('unexpected-response', (_req, res) => done(`http-${res.statusCode}`));
      socket.once('error', () => done('error'));
    });
  const start = () => {
    adapter = new WsSignalingTransportAdapter({ httpAdapter: { getHttpServer: () => httpServer } } as HttpAdapterHost);
    hosts = [];
    clients = [];
    adapter.onHost(socket => hosts.push(socket));
    adapter.onClient(socket => clients.push(socket));
    adapter.onModuleInit();
  };

  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.stubEnv('P2P_ALLOWED_ORIGINS', ' http://localhost:5173/ , ');
    httpServer = createServer((_req, res) => res.end());
    await new Promise<void>(done => httpServer.listen(0, '127.0.0.1', done));
    port = (httpServer.address() as AddressInfo).port;
    start();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    for (const socket of sockets.splice(0)) {
      socket.terminate();
    }
    await adapter.onModuleDestroy();
    await new Promise<void>(done => httpServer.close(() => done()));
  });

  it('should hand a host socket without checking its origin', async () => {
    expect(await outcome(open('/signal/host'))).toBe('open');
    expect(hosts).toHaveLength(1);
    expect(clients).toHaveLength(0);
  });

  it('should hand a client socket from the same origin or a listed one', async () => {
    expect(await outcome(open('/signal/client', `http://127.0.0.1:${port}`))).toBe('open');
    expect(await outcome(open('/signal/client', 'http://localhost:5173'))).toBe('open');
    expect(clients).toHaveLength(2);
  });

  it.each([undefined, 'http://evil.test', 'not a url'])('should refuse a client socket from the origin %s', async (origin) => {
    expect(await outcome(open('/signal/client', origin))).toBe('http-403');
    expect(clients).toHaveLength(0);
  });

  it('should destroy an upgrade to any other path', async () => {
    expect(await outcome(open('/other'))).toBe('error');
  });

  it('should exchange JSON signals, hand raw text as is and report the close', async () => {
    const socket = open('/signal/host');
    await outcome(socket);
    const host = hosts[0]!;
    const received: unknown[] = [];
    const unsubscribe = host.onMessage(data => received.push(data));
    const closed = new Promise<void>(done => host.onClose(done));
    const reply = new Promise<string>(done => socket.once('message', data => done(String(data))));

    socket.send('{"type":"host.close"}');
    socket.send('not json');
    host.send({ type: 'host.registered' });
    expect(await reply).toBe('{"type":"host.registered"}');
    await vi.waitFor(() => expect(received).toEqual([{ type: 'host.close' }, 'not json']));
    unsubscribe();
    host.close(4409, 'replaced');
    await closed;
    host.send({ type: 'host.registered' });
  });

  it('should keep a socket that answers pings and terminate one that does not', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await adapter.onModuleDestroy();
    start();
    const answering = open('/signal/host');
    const silent = open('/signal/host');
    await Promise.all([outcome(answering), outcome(silent)]);
    silent.pong = () => undefined;
    (silent as unknown as { _receiver: { removeAllListeners: (event: string) => void } })._receiver.removeAllListeners('ping');
    const terminated = new Promise<void>(done => silent.once('close', () => done()));

    vi.advanceTimersByTime(25_000);
    await vi.waitFor(() => new Promise(done => setTimeout(done, 20)));
    vi.advanceTimersByTime(25_000);

    await terminated;
    expect(answering.readyState).toBe(WebSocket.OPEN);
  });

  it('should survive a frame over the payload limit, closing only that socket', async () => {
    const offender = open('/signal/host');
    await outcome(offender);
    const code = closed(offender);
    offender.send('x'.repeat(70 * 1024));

    expect(await code).toBe(1009);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('signal_socket_error'));
    expect(await outcome(open('/signal/host'))).toBe('open');
  });

  it('should close a socket that sends more messages than its rate allows', async () => {
    const client = open('/signal/client', 'http://localhost:5173');
    await outcome(client);
    const code = closed(client);
    Array.from({ length: 65 }, () => client.send('{}'));

    expect(await code).toBe(1008);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('signal_rate_limited'));
  });

  it('should refuse sockets past the limit of one address', async () => {
    const opened = Array.from({ length: 20 }, () => open('/signal/host'));
    expect(await Promise.all(opened.map(outcome))).toEqual(Array.from({ length: 20 }, () => 'open'));

    expect(await outcome(open('/signal/host'))).toBe('http-429');
  });

  it('should refuse a new socket once the total is reached', async () => {
    const tracked = adapter['server'].clients as Set<WebSocket>;
    const fillers = Array.from({ length: 2_000 }, () => ({}) as WebSocket);
    fillers.forEach(filler => tracked.add(filler));

    expect(await outcome(open('/signal/host'))).toBe('http-503');
    fillers.forEach(filler => tracked.delete(filler));
  });

  it('should limit the sockets an address opens in a burst', async () => {
    for (let index = 0; index < 30; index += 1) {
      const socket = open('/signal/host');
      await outcome(socket);
      const code = closed(socket);
      socket.close();
      await code;
    }

    expect(await outcome(open('/signal/host'))).toBe('http-429');
  });

  it('should count the address the trusted proxies saw, whatever the client put before it', async () => {
    vi.stubEnv('P2P_TRUSTED_PROXY_HOPS', '1');
    await adapter.onModuleDestroy();
    start();
    const crowded = Array.from({ length: 20 }, (_, index) => open('/signal/host', undefined, `10.0.0.${index}, 203.0.113.1`));
    await Promise.all(crowded.map(outcome));

    expect(await outcome(open('/signal/host', undefined, '203.0.113.1'))).toBe('http-429');
    expect(await outcome(open('/signal/host', undefined, '203.0.113.2'))).toBe('open');
    expect(await outcome(open('/signal/host', undefined, ' , '))).toBe('open');
    expect(hosts.map(host => host.address)).toEqual([...Array.from({ length: 20 }, () => '203.0.113.1'), '203.0.113.2', '127.0.0.1']);
  });

  it('should forget an address once it has no socket and its whole allowance back', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    await adapter.onModuleDestroy();
    start();
    const socket = open('/signal/host');
    await outcome(socket);

    vi.advanceTimersByTime(25_000);
    expect(adapter['addresses'].size).toBe(1);
    socket.close();
    await vi.waitFor(() => expect([...adapter['addresses'].values()][0]?.sockets).toBe(0));
    vi.advanceTimersByTime(25_000);
    expect(adapter['addresses'].size).toBe(0);
  });
});
