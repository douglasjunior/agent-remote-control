import { SIGNALING_CLIENT_PATH, SIGNALING_HOST_PATH } from '@agent-remote-control/protocol/signaling';
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';


/** Routes the server answers itself; every other GET falls back to the web app's `index.html`. */
const SERVER_ROUTES = ['/health', SIGNALING_HOST_PATH, SIGNALING_CLIENT_PATH];
const PERMISSIONS_POLICY = 'camera=(), geolocation=(), microphone=(self), payment=(), usb=()';

function webDirectory(): string | undefined {
  const directory = process.env.P2P_WEB_DIR?.trim();
  return directory ? resolve(directory) : undefined;
}

/** CSP hashes of the inline scripts of the served `index.html`, such as the one that applies the theme before paint. */
function inlineScriptHashes(directory: string | undefined): string[] {
  const index = directory && join(directory, 'index.html');
  if (!index || !existsSync(index)) {
    return [];
  }
  const html = readFileSync(index, 'utf8');
  return Array.from(html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi), ([, body]) =>
    `'sha256-${createHash('sha256').update(body).digest('base64')}'`);
}

/**
 * Serves the build of `packages/web` made for remote access (`dist-p2p`), from `P2P_WEB_DIR`. The page holds the
 * access tokens of hosts that run agents, so it runs only its own scripts, talks only to its own origin and cannot be
 * framed; `index.html` is never cached, so a deploy reaches every browser at once. HTTPS and HSTS belong to the proxy
 * that terminates TLS.
 */
@Module({
  imports: [
    ServeStaticModule.forRootAsync({
      useFactory: () => {
        const directory = webDirectory();
        return directory
          ? [
            {
              rootPath: directory,
              exclude: SERVER_ROUTES,
              serveStaticOptions: {
                setHeaders: (response: Response, path: string) => {
                  if (basename(path) === 'index.html') {
                    response.setHeader('Cache-Control', 'no-store');
                  }
                },
              },
            },
          ]
          : [];
      },
    }),
  ],
})
export class WebAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    const headers = helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ['\'self\''],
          scriptSrc: ['\'self\'', ...inlineScriptHashes(webDirectory())],
          styleSrc: ['\'self\'', '\'unsafe-inline\''],
          imgSrc: ['\'self\'', 'data:', 'blob:'],
          mediaSrc: ['\'self\'', 'blob:'],
          fontSrc: ['\'self\'', 'data:'],
          connectSrc: ['\'self\''],
          objectSrc: ['\'none\''],
          baseUri: ['\'none\''],
          formAction: ['\'none\''],
          frameAncestors: ['\'none\''],
        },
      },
      strictTransportSecurity: false,
    });
    consumer
      .apply(headers, (_request: Request, response: Response, next: NextFunction) => {
        response.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
        next();
      })
      .forRoutes('*');
  }
}
