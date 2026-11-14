import { PROTOCOL_VERSION } from '@agent-remote-control/protocol/protocol-version';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebSocket } from 'ws';

import { AppModule } from './app.module.js';
import { TEST_HOSTS } from './modules/signaling/testing/test-hosts.js';


const FINGERPRINT = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const OFFER = `a=fingerprint:sha-256 ${Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0')).join(':')}\r\n`;

describe('AppModule', () => {
  let app: INestApplication;
  let base: string;
  const sockets: WebSocket[] = [];

  const next = (socket: WebSocket) => new Promise<unknown>(done => socket.once('message', data => done(JSON.parse(String(data)))));
  /** Opens a socket and waits for its first message, which a host socket gets as soon as it opens. */
  const open = async (path: string, origin?: string) => {
    const socket = new WebSocket(`${base.replace('http', 'ws')}${path}`, { headers: origin ? { origin } : {} });
    sockets.push(socket);
    const first = next(socket);
    await new Promise(done => socket.once('open', done));
    return { socket, first };
  };

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

  it('should introduce a browser to a registered host once the host accepts its proof', async () => {
    const identity = TEST_HOSTS[0]!;
    const { socket: host, first } = await open('/signal/host');
    const challenge = await first as { nonce: string };
    const registered = next(host);
    host.send(JSON.stringify(identity.register(challenge.nonce, PROTOCOL_VERSION)));
    expect(await registered).toEqual({ type: 'host.registered' });

    const { socket: client } = await open('/signal/client', base);
    const request = next(host);
    client.send(JSON.stringify({ type: 'client.connect', instanceId: identity.instanceId, fingerprint: FINGERPRINT, proof: 'p'.repeat(43) }));
    const { sessionId } = await request as { sessionId: string };
    const accepted = next(client);
    host.send(JSON.stringify({ type: 'host.accept', sessionId }));
    expect(await accepted).toMatchObject({ type: 'client.accepted', protocolVersion: PROTOCOL_VERSION });

    const offer = next(host);
    client.send(JSON.stringify({ type: 'client.offer', sdp: OFFER }));
    expect(await offer).toMatchObject({ type: 'session.offer', sdp: OFFER });
  });
});
