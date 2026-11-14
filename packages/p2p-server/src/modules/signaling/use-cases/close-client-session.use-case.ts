import { Injectable } from '@nestjs/common';

import { SignalingRegistryService } from '../services/signaling-registry.service.js';


/** Ends a session when its browser leaves; a host that already connected that browser keeps the connection. */
@Injectable()
export class CloseClientSessionUseCase {
  constructor(private readonly registry: SignalingRegistryService) {}

  execute(sessionId: string): void {
    const session = this.registry.removeSession(sessionId);
    if (session) {
      this.registry.host(session.instanceId)?.socket.send({ type: 'session.closed', sessionId });
    }
  }
}
