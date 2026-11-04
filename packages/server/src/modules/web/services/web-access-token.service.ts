import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';


import { resolveDataDirectory } from '../../orchestrator/utils/data-directory.util.js';


@Injectable()
export class WebAccessTokenService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WebAccessTokenService.name);
  private token?: string;

  onApplicationBootstrap(): void {
    this.logger.log(`Web interface access token: ${this.getToken()}`);
  }

  verify(candidate: string): boolean {
    const expected = Buffer.from(this.getToken());
    const received = Buffer.from(candidate);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  private getToken(): string {
    this.token ??= process.env.WEB_ACCESS_TOKEN?.trim() || this.loadOrCreateToken();
    return this.token;
  }

  private loadOrCreateToken(): string {
    const file = join(resolveDataDirectory(), 'web', 'access-token');
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
