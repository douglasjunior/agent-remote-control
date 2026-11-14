import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

import { AppController } from '../../app.controller.js';

import { WebAppModule } from './web-app.module.js';


@Module({ imports: [WebAppModule], controllers: [AppController] })
class TestAppModule {}

describe('WebAppModule', () => {
  let webDir: string;
  let app: NestExpressApplication | undefined;

  const startApp = async () => {
    app = await NestFactory.create<NestExpressApplication>(TestAppModule, { logger: false });
    await app.init();
    return app.getHttpServer();
  };

  beforeEach(() => {
    webDir = mkdtempSync(join(tmpdir(), 'p2p-web-'));
    writeFileSync(join(webDir, 'index.html'), '<html>arc</html>');
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.unstubAllEnvs();
    rmSync(webDir, { recursive: true, force: true });
  });

  it('should answer the routes of an instance with the index page and keep /health', async () => {
    vi.stubEnv('P2P_WEB_DIR', webDir);
    const server = await startApp();

    expect((await request(server).get('/i/0123456789abcdef0123/c/web-1')).text).toBe('<html>arc</html>');
    expect((await request(server).get('/health')).body).toEqual({ status: 'ok' });
  });

  it('should serve nothing without P2P_WEB_DIR', async () => {
    vi.stubEnv('P2P_WEB_DIR', '');
    const server = await startApp();

    expect((await request(server).get('/')).status).toBe(404);
  });
});
