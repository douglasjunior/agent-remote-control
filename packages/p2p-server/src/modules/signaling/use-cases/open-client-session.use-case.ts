import { type ClientSignal, SOURCE_BYTES } from '@agent-remote-control/protocol/signaling';
import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import type { SignalingSession } from '../models/signaling-session.model.js';
import type { ClientSocket } from '../ports/signaling-transport.port.js';
import { SignalingRegistryService } from '../services/signaling-registry.service.js';


/** Sessions a host negotiates at once; each one costs the host a peer connection. */
const MAX_SESSIONS_PER_INSTANCE = 16;

type ConnectSignal = Extract<ClientSignal, { type: 'client.connect' }>;

@Injectable()
export class OpenClientSessionUseCase {
  /** Keys the sources handed to hosts, so a host tells addresses apart without learning them. */
  private readonly sourceKey = randomBytes(32);

  constructor(private readonly registry: SignalingRegistryService) {}

  /**
   * Opens a session with the host of the instance and hands it the browser's proof of the access token, with the
   * source of the browser's address. The browser gets nothing else, the ICE servers included, until the host accepts
   * the proof.
   */
  execute(client: ClientSocket, { instanceId, fingerprint, proof }: ConnectSignal): SignalingSession | undefined {
    const host = this.registry.host(instanceId);
    if (!host || this.registry.sessionCount(instanceId) >= MAX_SESSIONS_PER_INSTANCE) {
      client.send({ type: 'client.unavailable' });
      client.close();
      return undefined;
    }
    const session: SignalingSession = { id: randomUUID(), instanceId, client, fingerprint, state: 'requested', candidates: 0 };
    this.registry.addSession(session);
    host.socket.send({ type: 'session.request', sessionId: session.id, source: this.sourceOf(client.address), fingerprint, proof });
    return session;
  }

  private sourceOf(address: string): string {
    return createHmac('sha256', this.sourceKey).update(address).digest().subarray(0, SOURCE_BYTES).toString('base64url');
  }
}
