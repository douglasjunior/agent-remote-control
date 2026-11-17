import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

import { AppController } from '../../app.controller.js';

import { WebAppModule } from './web-app.module.js';


const THEME = 'document.documentElement.classList.add("dark");';

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
    writeFileSync(join(webDir, 'index.html'), `<html>arc<script>${THEME}</script><script type="module" src="/assets/app.js"></script></html>`);
    mkdirSync(join(webDir, 'assets'));
    writeFileSync(join(webDir, 'assets', 'app.js'), 'export {};');
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    rs.unstubAllEnvs();
    rmSync(webDir, { recursive: true, force: true });
  });

  it('should answer the routes of an instance with the index page and keep /health', async () => {
    rs.stubEnv('P2P_WEB_DIR', webDir);
    const server = await startApp();

    expect((await request(server).get('/i/0123456789abcdef0123/c/web-1')).text).toContain('<html>arc');
    expect((await request(server).get('/health')).body).toEqual({ status: 'ok' });
  });

  it('should serve nothing without P2P_WEB_DIR', async () => {
    rs.stubEnv('P2P_WEB_DIR', '');
    const server = await startApp();

    expect((await request(server).get('/')).status).toBe(404);
  });

  it('should send the security headers, allowing only the inline scripts of the index page', async () => {
    rs.stubEnv('P2P_WEB_DIR', webDir);
    const server = await startApp();
    const page = await request(server).get('/i/0123456789abcdef0123');
    const asset = await request(server).get('/assets/app.js');
    const hash = createHash('sha256').update(THEME).digest('base64');

    expect(page.headers['content-security-policy']).toContain(`script-src 'self' 'sha256-${hash}'`);
    expect(page.headers['content-security-policy']).toContain('frame-ancestors \'none\'');
    expect(page.headers).toMatchObject({
      'cache-control': 'no-store',
      'x-frame-options': 'SAMEORIGIN',
      'x-content-type-options': 'nosniff',
      'permissions-policy': expect.stringContaining('microphone=(self)'),
    });
    expect(page.headers['x-powered-by']).toBeUndefined();
    expect(page.headers['strict-transport-security']).toBeUndefined();
    expect(asset.headers['cache-control']).not.toBe('no-store');
    expect(asset.headers['x-content-type-options']).toBe('nosniff');
  });

  it('should allow no inline script when the web app is not served', async () => {
    rs.stubEnv('P2P_WEB_DIR', '');
    const server = await startApp();

    expect((await request(server).get('/health')).headers['content-security-policy']).toContain('script-src \'self\';');
  });
});
