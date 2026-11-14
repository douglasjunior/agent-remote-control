import { buildRemoteLink } from '@agent-remote-control/protocol/remote-link';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';


import { DataDirectoryService } from '../../paths/services/data-directory.service.js';
import { RemoteIdentityService } from '../../remote/services/remote-identity.service.js';


@Injectable()
export class WebAccessTokenService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WebAccessTokenService.name);
  private token?: string;

  constructor(
    private readonly dataDirectory: DataDirectoryService,
    private readonly remoteIdentity: RemoteIdentityService,
  ) {}

  /** Logs the token, and the remote link that carries it; this logger's context stays out of the log files. */
  async onApplicationBootstrap(): Promise<void> {
    this.logger.log(`Web interface access token: ${this.getToken()}`);
    if (this.remoteIdentity.isEnabled()) {
      const { instanceId, fingerprint } = await this.remoteIdentity.identity();
      this.logger.log(`Remote access link: ${buildRemoteLink(this.remoteIdentity.baseUrl(), instanceId, fingerprint, this.getToken())}`);
    }
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
