import { Injectable, Logger } from '@nestjs/common';

import type { HostSocket } from '../ports/signaling-transport.port.js';
import { SignalingRegistryService } from '../services/signaling-registry.service.js';


/** Takes a host offline and ends the sessions still negotiating with it. */
@Injectable()
export class DisconnectHostUseCase {
  private readonly logger = new Logger(DisconnectHostUseCase.name);

  constructor(private readonly registry: SignalingRegistryService) {}

  execute(socket: HostSocket): void {
    const sessions = this.registry.removeHost(socket);
    for (const session of sessions) {
      session.client.send({ type: 'session.closed' });
      session.client.close();
    }
    this.logger.log(`host_disconnected: sessions=${sessions.length}`);
  }
}
