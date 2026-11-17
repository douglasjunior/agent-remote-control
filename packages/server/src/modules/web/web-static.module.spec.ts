import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

import { WebStaticModule } from './web-static.module.js';


@Controller()
class HealthController {
  @Get('health')
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}

@Module({ imports: [WebStaticModule], controllers: [HealthController] })
class TestAppModule {}

describe('WebStaticModule', () => {
  let webDir: string;
  let app: NestExpressApplication | undefined;

  const startApp = async () => {
    app = await NestFactory.create<NestExpressApplication>(TestAppModule, { logger: false });
    await app.init();
    return app.getHttpServer();
  };

  beforeEach(() => {
    webDir = mkdtempSync(join(tmpdir(), 'web-static-'));
    mkdirSync(join(webDir, 'assets'));
    writeFileSync(join(webDir, 'index.html'), '<html>arc</html>');
    writeFileSync(join(webDir, 'assets', 'app.js'), 'console.log("arc");');
    rs.stubEnv('WEB_STATIC_DIR', webDir);
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    rs.unstubAllEnvs();
    rmSync(webDir, { recursive: true, force: true });
  });

  it('should serve the index page and the built assets', async () => {
    const server = await startApp();

    const index = await request(server).get('/');
    const asset = await request(server).get('/assets/app.js');

    expect(index.text).toBe('<html>arc</html>');
    expect(asset.text).toBe('console.log("arc");');
  });

  it.each(['/c/abc', '/c/abc/tasks/t1', '/skills/my.skill'])('should answer the client-side route %s with the index page', async (path) => {
    const server = await startApp();

    const response = await request(server).get(path);

    expect(response.status).toBe(200);
    expect(response.text).toBe('<html>arc</html>');
  });

  it('should leave the server routes to Nest', async () => {
    const server = await startApp();

    const response = await request(server).get('/health');

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('should serve nothing when WEB_STATIC_DIR is not set', async () => {
    rs.stubEnv('WEB_STATIC_DIR', ' ');
    const server = await startApp();

    const response = await request(server).get('/');

    expect(response.status).toBe(404);
  });
});
