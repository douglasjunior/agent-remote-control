import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { WebSocket } from 'ws';


describe('AppController (e2e)', () => {
  let app: INestApplication;
  let dataDir: string;

  beforeAll(async () => {
    vi.stubEnv('WEB_ACCESS_TOKEN', 'test');
    dataDir = mkdtempSync(join(tmpdir(), 'web-e2e-'));
    vi.stubEnv('DATA_DIR', dataDir);

    const { AppModule } = await import('./../src/app.module.js');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
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

  it('creates a conversation, reads its history and asks for the agent configuration', async () => {
    const events = await new Promise<Record<string, any>[]>((done, fail) => {
      const client = new WebSocket(`ws://${host()}/ws`, { headers: { origin: `http://${host()}` } });
      const received: Record<string, any>[] = [];
      const send = (command: unknown) => client.send(JSON.stringify(command));
      client.on('open', () => send({ type: 'auth', token: 'test' }));
      client.on('message', (raw) => {
        const event = JSON.parse(raw.toString());
        received.push(event);
        if (event.type === 'auth.ok') {
          send({ type: 'conversation.create', requestId: 'r1' });
        } else if (event.type === 'conversation.created') {
          send({ type: 'conversation.history', conversationId: event.conversation.id });
          send({ type: 'agents.list' });
          send({ type: 'profiles.get', conversationId: event.conversation.id });
        } else if (event.type === 'profiles') {
          client.close();
        }
      });
      client.on('close', () => done(received));
      client.on('error', fail);
    });

    const created = events.find(event => event.type === 'conversation.created');
    expect(created?.requestId).toBe('r1');
    expect(created?.conversation.id).toMatch(/^web-/);
    expect(events).toContainEqual({
      type: 'conversation.history',
      interrupted: [],
      conversationId: created?.conversation.id,
      entries: [],
      state: 'idle',
    });
    expect(events.find(event => event.type === 'agents.list')?.agents).toBeInstanceOf(Array);
    const profiles = events.find(event => event.type === 'profiles');
    expect(profiles?.conversationId).toBe(created?.conversation.id);
    expect(typeof profiles?.configured).toBe('boolean');
    expect(profiles?.profiles.length).toBeGreaterThan(0);
  });

  it('rejects an answer when no question is open', async () => {
    const errors = await new Promise<Record<string, any>[]>((done, fail) => {
      const client = new WebSocket(`ws://${host()}/ws`, { headers: { origin: `http://${host()}` } });
      const received: Record<string, any>[] = [];
      const send = (command: unknown) => client.send(JSON.stringify(command));
      client.on('open', () => send({ type: 'auth', token: 'test' }));
      client.on('message', (raw) => {
        const event = JSON.parse(raw.toString());
        if (event.type === 'auth.ok') {
          send({ type: 'conversation.create', requestId: 'r1' });
        } else if (event.type === 'conversation.created') {
          const conversationId = event.conversation.id;
          send({ type: 'question.answer', conversationId, answer: { kind: 'option', optionIndex: 1 } });
        } else if (event.type === 'error') {
          received.push(event);
          client.close();
        }
      });
      client.on('close', () => done(received));
      client.on('error', fail);
    });

    expect(errors.map(event => event.message)).toEqual(['There is no open question']);
  });
});
