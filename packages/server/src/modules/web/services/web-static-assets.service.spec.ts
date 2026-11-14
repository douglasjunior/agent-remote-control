import { Controller, Get, Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

import { WebStaticAssetsService } from './web-static-assets.service.js';


@Controller()
class HealthController {
  @Get('health')
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}

@Module({ controllers: [HealthController] })
class HealthModule {}

describe('WebStaticAssetsService', () => {
  let webDir: string;
  let app: NestExpressApplication | undefined;

  const startApp = async (): Promise<NestExpressApplication> => {
    app = await NestFactory.create<NestExpressApplication>(HealthModule, { logger: false });
    new WebStaticAssetsService().register(app);
    await app.init();
    return app;
  };

  beforeEach(() => {
    webDir = mkdtempSync(join(tmpdir(), 'web-static-'));
    mkdirSync(join(webDir, 'assets'));
    writeFileSync(join(webDir, 'index.html'), '<html>arc</html>');
    writeFileSync(join(webDir, 'assets', 'app.js'), 'console.log("arc");');
    vi.stubEnv('WEB_STATIC_DIR', webDir);
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(webDir, { recursive: true, force: true });
  });

  it('should serve the index page and the built assets', async () => {
    const server = (await startApp()).getHttpServer();

    const index = await request(server).get('/');
    const asset = await request(server).get('/assets/app.js');

    expect(index.text).toBe('<html>arc</html>');
    expect(asset.text).toBe('console.log("arc");');
  });

  it('should answer client-side routes with the index page', async () => {
    const server = (await startApp()).getHttpServer();

    const response = await request(server).get('/conversations/abc');

    expect(response.status).toBe(200);
    expect(response.text).toBe('<html>arc</html>');
  });

  it('should leave the server routes to Nest', async () => {
    const server = (await startApp()).getHttpServer();

    const response = await request(server).get('/health');

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('should not intercept requests other than GET and HEAD', async () => {
    const server = (await startApp()).getHttpServer();

    const response = await request(server).post('/conversations/abc');

    expect(response.status).toBe(404);
  });

  it('should serve nothing when WEB_STATIC_DIR is not set', async () => {
    vi.stubEnv('WEB_STATIC_DIR', '');
    const server = (await startApp()).getHttpServer();

    const response = await request(server).get('/');

    expect(response.status).toBe(404);
  });

  it('should warn and serve nothing when the directory has no index.html', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.stubEnv('WEB_STATIC_DIR', join(webDir, 'assets'));
    const server = (await startApp()).getHttpServer();

    const response = await request(server).get('/');

    expect(response.status).toBe(404);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('has no index.html'));
  });
});
