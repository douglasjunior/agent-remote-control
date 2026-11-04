import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebSocket } from 'ws';


describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    vi.stubEnv('WEB_ACCESS_TOKEN', 'test');

    const { AppModule } = await import('./../src/app.module.js');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const host = () => `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

  const authenticate = (token: string) =>
    new Promise<{ messages: unknown[]; closeCode: number }>((done, fail) => {
      const client = new WebSocket(`ws://${host()}/ws`, { headers: { origin: `http://${host()}` } });
      const messages: unknown[] = [];
      client.on('open', () => client.send(JSON.stringify({ type: 'auth', token })));
      client.on('message', (raw) => {
        const event = JSON.parse(raw.toString());
        messages.push(event);
        if (event.type === 'auth.ok') {
          client.send(JSON.stringify({ type: 'conversation.list' }));
        } else if (event.type === 'conversation.list') {
          client.close();
        }
      });
      client.on('close', closeCode => done({ messages, closeCode }));
      client.on('error', fail);
    });

  it('/health (GET)', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });

  it('authenticates over /ws and lists conversations', async () => {
    const { messages } = await authenticate('test');

    expect(messages).toEqual([{ type: 'auth.ok' }, { type: 'conversation.list', conversations: [] }]);
  });

  it('closes a wrong token with 4401', async () => {
    const { messages, closeCode } = await authenticate('wrong');

    expect(messages).toEqual([{ type: 'auth.failed' }]);
    expect(closeCode).toBe(4401);
  });

  it('refuses a foreign origin with 403', async () => {
    const status = await new Promise<number>((done) => {
      const client = new WebSocket(`ws://${host()}/ws`, { headers: { origin: 'http://evil.test' } });
      client.on('unexpected-response', (_req, res) => done(res.statusCode ?? 0));
      client.on('error', () => undefined);
    });

    expect(status).toBe(403);
  });
});
