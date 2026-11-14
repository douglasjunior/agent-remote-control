import type { IceServer } from '@agent-remote-control/protocol/signaling';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createHmac } from 'node:crypto';


const DEFAULT_STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];
const DEFAULT_TURN_TTL_SECONDS = 24 * 60 * 60;

/** The STUN and TURN servers handed to both peers of a session. */
@Injectable()
export class IceServersService implements OnModuleInit {
  private readonly logger = new Logger(IceServersService.name);
  private readonly stunUrls = this.parseUrls(process.env.P2P_STUN_URLS) ?? DEFAULT_STUN_URLS;
  private readonly turnUrls = this.parseUrls(process.env.P2P_TURN_URLS) ?? [];
  private readonly turnSecret = process.env.P2P_TURN_SECRET?.trim() ?? '';
  private readonly turnTtlSeconds = this.parseTtl(process.env.P2P_TURN_TTL_SECONDS);

  onModuleInit(): void {
    this.logger.log(this.turnEnabled() ? `TURN relay: ${this.turnUrls.join(', ')}` : 'TURN relay: off');
  }

  /**
   * STUN for everyone, plus TURN with a credential of coturn's REST API (`use-auth-secret`): the username is
   * `<expiry>:<instance id>` and the password its HMAC-SHA1 under the shared secret, so it expires on its own.
   */
  forInstance(instanceId: string): IceServer[] {
    const servers: IceServer[] = [{ urls: this.stunUrls }];
    if (this.turnEnabled()) {
      const username = `${Math.floor(Date.now() / 1000) + this.turnTtlSeconds}:${instanceId}`;
      const credential = createHmac('sha1', this.turnSecret).update(username).digest('base64');
      servers.push({ urls: this.turnUrls, username, credential });
    }
    return servers;
  }

  private turnEnabled(): boolean {
    return this.turnUrls.length > 0 && this.turnSecret.length > 0;
  }

  private parseUrls(raw: string | undefined): string[] | undefined {
    const urls = (raw ?? '').split(',').map(url => url.trim()).filter(url => url.length > 0);
    return urls.length > 0 ? urls : undefined;
  }

  private parseTtl(raw: string | undefined): number {
    const seconds = Number(raw);
    return Number.isInteger(seconds) && seconds > 0 ? seconds : DEFAULT_TURN_TTL_SECONDS;
  }
}
