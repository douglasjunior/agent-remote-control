import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleInit } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';

import { DataDirectoryService } from '../../paths/services/data-directory.service.js';
import { ILockedFilesPort } from '../../storage/ports/locked-files.port.js';


const TOKEN_FILE_MODE = 0o600;

/** The token that lets a browser drive the agents of this host, locally over the WebSocket and remotely alike. */
@Injectable()
export class AccessTokenService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(AccessTokenService.name);
  private stored?: string;

  constructor(
    private readonly dataDirectory: DataDirectoryService,
    @Inject(ILockedFilesPort) private readonly files: ILockedFilesPort,
  ) {}

  /** Generates the token under the file's lock, so hosts that start together on one `DATA_DIR` share one token. */
  async onModuleInit(): Promise<void> {
    if (this.fromEnvironment()) {
      return;
    }
    const file = this.files.text(join(this.dataDirectory.resolve(), 'web', 'access-token'), { mode: TOKEN_FILE_MODE });
    const token = await file.update(current => (current?.trim() ? undefined : randomBytes(24).toString('base64url')));
    this.stored = token!.trim();
  }

  /** Logs the token; this logger's context stays out of the log files. */
  onApplicationBootstrap(): void {
    this.logger.log(`Web interface access token: ${this.token()}`);
  }

  /** `WEB_ACCESS_TOKEN`, otherwise the one generated once into `<DATA_DIR>/web/access-token` when the module starts. */
  token(): string {
    const token = this.fromEnvironment() || this.stored;
    if (!token) {
      throw new Error('The access token is read when the module starts');
    }
    return token;
  }

  verify(candidate: string): boolean {
    const expected = Buffer.from(this.token());
    const received = Buffer.from(candidate);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  private fromEnvironment(): string | undefined {
    return process.env.WEB_ACCESS_TOKEN?.trim() || undefined;
  }
}
