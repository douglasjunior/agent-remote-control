import type { HostSignal } from '@agent-remote-control/protocol/signaling';
import { Injectable } from '@nestjs/common';

import type { HostSocket } from '../ports/signaling-transport.port.js';
import { SignalingRegistryService } from '../services/signaling-registry.service.js';


type SessionSignal = Exclude<HostSignal, { type: 'host.register' }>;

@Injectable()
export class RelayHostSignalUseCase {
  constructor(private readonly registry: SignalingRegistryService) {}

  /** Hands the host's answer and candidates to the browser of the session, ignoring sessions of other instances. */
  execute(host: HostSocket, signal: SessionSignal): void {
    const session = this.registry.session(signal.sessionId);
    if (!session || this.registry.host(session.instanceId)?.socket !== host) {
      return;
    }
    if (signal.type === 'host.answer') {
      session.client.send({ type: 'session.answer', sdp: signal.sdp });
      return;
    }
    if (signal.type === 'host.candidate') {
      session.client.send({ type: 'session.candidate', candidate: signal.candidate, mid: signal.mid });
      return;
    }
    this.registry.removeSession(session.id);
    session.client.send({ type: 'session.closed' });
    session.client.close();
  }
}
