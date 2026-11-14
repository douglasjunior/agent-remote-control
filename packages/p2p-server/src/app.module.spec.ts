import { PROTOCOL_VERSION } from '@agent-remote-control/protocol/protocol-version';
import { deriveInstanceId } from '@agent-remote-control/protocol/remote-link';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebSocket } from 'ws';

import { AppModule } from './app.module.js';


describe('AppModule', () => {
  let app: INestApplication;
  let base: string;
  const sockets: WebSocket[] = [];

  const open = async (path: string, origin?: string) => {
    const socket = new WebSocket(`${base.replace('http', 'ws')}${path}`, { headers: origin ? { origin } : {} });
    sockets.push(socket);
    await new Promise(done => socket.once('open', done));
    return socket;
  };
  const next = (socket: WebSocket) => new Promise<unknown>(done => socket.once('message', data => done(JSON.parse(String(data)))));

  beforeEach(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    sockets.splice(0).forEach(socket => socket.terminate());
    await app.close();
  });

  it('should answer /health', async () => {
    expect((await request(app.getHttpServer()).get('/health')).body).toEqual({ status: 'ok' });
  });

  it('should introduce a browser to a registered host', async () => {
    const secret = 'secret';
    const instanceId = await deriveInstanceId(secret);
    const host = await open('/signal/host');
    const registered = next(host);
    host.send(JSON.stringify({ type: 'host.register', instanceId, secret, protocolVersion: PROTOCOL_VERSION }));
    expect(await registered).toEqual({ type: 'host.registered' });

    const client = await open('/signal/client', base);
    const accepted = next(client);
    client.send(JSON.stringify({ type: 'client.connect', instanceId }));
    expect(await accepted).toMatchObject({ type: 'client.accepted', protocolVersion: PROTOCOL_VERSION });

    const offer = next(host);
    client.send(JSON.stringify({ type: 'client.offer', sdp: 'offer' }));
    expect(await offer).toMatchObject({ type: 'session.offer', sdp: 'offer' });
  });
});
