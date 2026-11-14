import { sdpFingerprint } from '@agent-remote-control/protocol/fingerprint';
import { type ClientSignal, MAX_CANDIDATES_PER_SESSION } from '@agent-remote-control/protocol/signaling';
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
   * Hands the host of the session the browser's offer, once the host accepted the session and only when it announces
   * the certificate the browser proved its token for, then up to `MAX_CANDIDATES_PER_SESSION` candidates. Returns
   * false for any other signal, which ends the browser's socket.
   */
  execute(sessionId: string, signal: NegotiationSignal): boolean {
    const session = this.registry.session(sessionId);
    const host = session && this.registry.host(session.instanceId);
    if (!session || !host) {
      return false;
    }
    if (signal.type === 'client.offer') {
      if (session.state !== 'accepted' || sdpFingerprint(signal.sdp) !== session.fingerprint) {
        return false;
      }
      this.registry.updateSession(sessionId, { state: 'offered' });
      host.socket.send({ type: 'session.offer', sessionId, sdp: signal.sdp, iceServers: this.iceServers.forInstance(session.instanceId) });
      return true;
    }
    if (session.state !== 'offered' || session.candidates >= MAX_CANDIDATES_PER_SESSION) {
      return false;
    }
    this.registry.updateSession(sessionId, { candidates: session.candidates + 1 });
    host.socket.send({ type: 'session.candidate', sessionId, candidate: signal.candidate, mid: signal.mid });
    return true;
  }
}
