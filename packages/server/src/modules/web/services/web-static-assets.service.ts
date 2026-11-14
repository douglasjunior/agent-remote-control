import { Injectable, Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';


const SERVER_ROUTES = ['/health', '/ws'];

@Injectable()
export class WebStaticAssetsService {
  private readonly logger = new Logger(WebStaticAssetsService.name);

  register(app: NestExpressApplication): void {
    const directory = process.env.WEB_STATIC_DIR?.trim();
    if (!directory) {
      return;
    }
    const root = resolve(directory);
    const indexFile = join(root, 'index.html');
    if (!existsSync(indexFile)) {
      this.logger.warn(`WEB_STATIC_DIR has no index.html, the web interface is not served: ${root}`);
      return;
    }

    app.useStaticAssets(root);
    // Client-side routes (react-router) resolve to the single page; the server's own routes are left to Nest.
    app.use((request: Request, response: Response, next: NextFunction) => {
      const isPageRequest = request.method === 'GET' || request.method === 'HEAD';
      if (!isPageRequest || SERVER_ROUTES.includes(request.path)) {
        next();
        return;
      }
      response.sendFile(indexFile);
    });
    this.logger.log(`Serving the web interface from ${root}`);
  }
}
