import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { SignalingSession } from '../models/signaling-session.model.js';
import type { ClientSocket } from '../ports/signaling-transport.port.js';
import { IceServersService } from '../services/ice-servers.service.js';
import { SignalingRegistryService } from '../services/signaling-registry.service.js';


/** Sessions a host negotiates at once; each one costs the host a peer connection. */
const MAX_SESSIONS_PER_INSTANCE = 16;

@Injectable()
export class OpenClientSessionUseCase {
  constructor(
    private readonly registry: SignalingRegistryService,
    private readonly iceServers: IceServersService,
  ) {}

  /**
   * Opens a session with the host of the instance and hands the browser the ICE servers, TURN credentials included,
   * only then: nobody gets a relay credential without a host online to negotiate with.
   */
  execute(client: ClientSocket, instanceId: string): SignalingSession | undefined {
    const host = this.registry.host(instanceId);
    if (!host || this.registry.sessionCount(instanceId) >= MAX_SESSIONS_PER_INSTANCE) {
      client.send({ type: 'client.unavailable' });
      client.close();
      return undefined;
    }
    const session: SignalingSession = { id: randomUUID(), instanceId, client, offered: false };
    this.registry.addSession(session);
    client.send({
      type: 'client.accepted',
      iceServers: this.iceServers.forInstance(instanceId),
      protocolVersion: host.protocolVersion,
    });
    return session;
  }
}
