import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { DataDirectoryService } from '../../paths/services/data-directory.service.js';


/** The token that lets a browser drive the agents of this host, locally over the WebSocket and remotely alike. */
@Injectable()
export class AccessTokenService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AccessTokenService.name);
  private value?: string;

  constructor(private readonly dataDirectory: DataDirectoryService) {}

  /** Logs the token; this logger's context stays out of the log files. */
  onApplicationBootstrap(): void {
    this.logger.log(`Web interface access token: ${this.token()}`);
  }

  /** `WEB_ACCESS_TOKEN`, otherwise the one generated once into `<DATA_DIR>/web/access-token`. */
  token(): string {
    this.value ??= process.env.WEB_ACCESS_TOKEN?.trim() || this.loadOrCreateToken();
    return this.value;
  }

  verify(candidate: string): boolean {
    const expected = Buffer.from(this.token());
    const received = Buffer.from(candidate);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  private loadOrCreateToken(): string {
    const file = join(this.dataDirectory.resolve(), 'web', 'access-token');
    if (existsSync(file)) {
      const stored = readFileSync(file, 'utf8').trim();
      if (stored) {
        return stored;
      }
    }
    const generated = randomBytes(24).toString('base64url');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, generated, { mode: 0o600 });
    return generated;
  }
}
