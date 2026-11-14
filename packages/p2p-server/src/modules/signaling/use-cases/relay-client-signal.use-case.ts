import type { ClientSignal } from '@agent-remote-control/protocol/signaling';
import { Injectable } from '@nestjs/common';

import { IceServersService } from '../services/ice-servers.service.js';
import { SignalingRegistryService } from '../services/signaling-registry.service.js';


type NegotiationSignal = Exclude<ClientSignal, { type: 'client.connect' }>;

@Injectable()
export class RelayClientSignalUseCase {
  constructor(
    private readonly registry: SignalingRegistryService,
    private readonly iceServers: IceServersService,
  ) {}

  /**
   * Hands the browser's offer, then its candidates, to the host of the session. Returns false for a signal out of
   * that order or for a session that is over, which ends the browser's socket.
   */
  execute(sessionId: string, signal: NegotiationSignal): boolean {
    const session = this.registry.session(sessionId);
    const host = session && this.registry.host(session.instanceId);
    if (!session || !host) {
      return false;
    }
    if (signal.type === 'client.offer') {
      if (session.offered) {
        return false;
      }
      this.registry.markOffered(sessionId);
      host.socket.send({ type: 'session.offer', sessionId, sdp: signal.sdp, iceServers: this.iceServers.forInstance(session.instanceId) });
      return true;
    }
    if (!session.offered) {
      return false;
    }
    host.socket.send({ type: 'session.candidate', sessionId, candidate: signal.candidate, mid: signal.mid });
    return true;
  }
}
