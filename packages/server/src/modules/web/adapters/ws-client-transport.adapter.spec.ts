import type { HttpAdapterHost } from '@nestjs/core';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';

import type { IClientConnection } from '../ports/client-transport.port.js';

import { WsClientTransportAdapter } from './ws-client-transport.adapter.js';


describe('WsClientTransportAdapter', () => {
  let httpServer: Server;
  let adapter: WsClientTransportAdapter;
  let port: number;
  let connections: IClientConnection[];
  const clients: WebSocket[] = [];

  const open = (path: string, origin?: string) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: origin ? { origin } : {} });
    clients.push(client);
    return client;
  };
  const outcome = (client: WebSocket) =>
    new Promise<string>((done) => {
      client.once('open', () => done('open'));
      client.once('unexpected-response', (_req, res) => done(`http-${res.statusCode}`));
      client.once('error', () => done('error'));
    });

  beforeEach(async () => {
    vi.stubEnv('WEB_ALLOWED_ORIGINS', 'http://localhost:5173');
    httpServer = createServer((_req, res) => res.end());
    await new Promise<void>(done => httpServer.listen(0, '127.0.0.1', done));
    port = (httpServer.address() as AddressInfo).port;
    adapter = new WsClientTransportAdapter({ httpAdapter: { getHttpServer: () => httpServer } } as HttpAdapterHost);
    connections = [];
    adapter.onConnection(connection => connections.push(connection));
    adapter.onModuleInit();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const client of clients.splice(0)) {
      client.terminate();
    }
    await adapter.onModuleDestroy();
    await new Promise<void>(done => httpServer.close(() => done()));
  });

  it('accepts a same-origin upgrade on /ws', async () => {
    const client = open('/ws', `http://127.0.0.1:${port}`);

    expect(await outcome(client)).toBe('open');
    expect(connections).toHaveLength(1);
  });

  it('accepts an origin listed in WEB_ALLOWED_ORIGINS', async () => {
    expect(await outcome(open('/ws', 'http://localhost:5173'))).toBe('open');
  });

  it('rejects a foreign origin with 403', async () => {
    expect(await outcome(open('/ws', 'http://evil.test'))).toBe('http-403');
    expect(connections).toHaveLength(0);
  });

  it('rejects the same hostname on another port and a malformed origin', async () => {
    expect(await outcome(open('/ws', `http://127.0.0.1:${port + 1}`))).toBe('http-403');
    expect(await outcome(open('/ws', 'not a url'))).toBe('http-403');
  });

  describe('the list in WEB_ALLOWED_ORIGINS', () => {
    const restartWith = async (raw: string | undefined) => {
      await adapter.onModuleDestroy();
      vi.stubEnv('WEB_ALLOWED_ORIGINS', raw);
      adapter = new WsClientTransportAdapter({ httpAdapter: { getHttpServer: () => httpServer } } as HttpAdapterHost);
      adapter.onModuleInit();
    };

    it('ignores spaces, empty entries and trailing slashes', async () => {
      await restartWith(' http://localhost:5173/ , ,http://other.test ');

      expect(await outcome(open('/ws', 'http://localhost:5173'))).toBe('open');
      expect(await outcome(open('/ws', 'http://other.test'))).toBe('open');
      expect(await outcome(open('/ws', 'http://evil.test'))).toBe('http-403');
    });

    it('lets only the same origin in when it is unset', async () => {
      await restartWith(undefined);

      expect(await outcome(open('/ws', 'http://localhost:5173'))).toBe('http-403');
      expect(await outcome(open('/ws', `http://127.0.0.1:${port}`))).toBe('open');
    });
  });

  it('rejects an upgrade without an origin', async () => {
    expect(await outcome(open('/ws'))).toBe('http-403');
  });

  it('does not upgrade other paths', async () => {
    expect(await outcome(open('/other', `http://127.0.0.1:${port}`))).toBe('error');
    expect(connections).toHaveLength(0);
  });

  it('forwards parsed JSON and raw text, sends events and propagates close', async () => {
    const client = open('/ws', `http://127.0.0.1:${port}`);
    await outcome(client);
    const connection = connections[0];
    const received: unknown[] = [];
    const unsubscribe = connection.onMessage(data => received.push(data));
    const closed = new Promise<void>(done => connection.onClose(done));
    const incoming = new Promise<string>(done => client.once('message', raw => done(raw.toString())));

    client.send(JSON.stringify({ type: 'auth', token: 't' }));
    client.send('not json');
    await vi.waitFor(() => expect(received).toHaveLength(2));
    connection.send({ type: 'auth.ok' });

    expect(received).toEqual([{ type: 'auth', token: 't' }, 'not json']);
    expect(await incoming).toBe('{"type":"auth.ok"}');

    unsubscribe();
    client.close();
    await closed;
    connection.send({ type: 'auth.ok' });
  });

  it('closes the connection from the server with a code', async () => {
    const client = open('/ws', `http://127.0.0.1:${port}`);
    await outcome(client);
    const closeCode = new Promise<number>(done => client.once('close', done));

    connections[0].close(4401, 'unauthorized');

    expect(await closeCode).toBe(4401);
  });

  it('stops notifying a listener after it unsubscribes', async () => {
    const extra: IClientConnection[] = [];
    const unsubscribe = adapter.onConnection(connection => extra.push(connection));
    unsubscribe();

    await outcome(open('/ws', `http://127.0.0.1:${port}`));

    expect(extra).toHaveLength(0);
  });
});
