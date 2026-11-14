import type { HostSignal } from '@agent-remote-control/protocol/signaling';
import { Injectable, Logger } from '@nestjs/common';

import type { SignalingSession } from '../models/signaling-session.model.js';
import type { HostSocket } from '../ports/signaling-transport.port.js';
import { IceServersService } from '../services/ice-servers.service.js';
import { SignalingRegistryService } from '../services/signaling-registry.service.js';


type SessionSignal = Exclude<HostSignal, { type: 'host.register' }>;

@Injectable()
export class RelayHostSignalUseCase {
  private readonly logger = new Logger(RelayHostSignalUseCase.name);

  constructor(
    private readonly registry: SignalingRegistryService,
    private readonly iceServers: IceServersService,
  ) {}

  /**
   * Carries out the host's verdict on a session and hands its answer and candidates to the browser, ignoring sessions
   * of other instances. Accepting is what hands the browser the ICE servers, TURN credentials included.
   */
  execute(host: HostSocket, signal: SessionSignal): void {
    const session = this.registry.session(signal.sessionId);
    const registered = session && this.registry.host(session.instanceId);
    if (!session || registered?.socket !== host) {
      return;
    }
    switch (signal.type) {
      case 'host.accept':
        if (session.state === 'requested') {
          this.registry.updateSession(session.id, { state: 'accepted' });
          session.client.send({
            type: 'client.accepted',
            iceServers: this.iceServers.forInstance(session.instanceId),
            protocolVersion: registered.protocolVersion,
          });
        }
        return;
      case 'host.reject':
        this.logger.warn(`session_rejected: instance=${session.instanceId}`);
        this.end(session, { type: 'client.rejected' });
        return;
      case 'host.answer':
        session.client.send({ type: 'session.answer', sdp: signal.sdp });
        return;
      case 'host.candidate':
        session.client.send({ type: 'session.candidate', candidate: signal.candidate, mid: signal.mid });
        return;
      case 'host.close':
        this.end(session, { type: 'session.closed' });
    }
  }

  private end(session: SignalingSession, signal: { type: 'client.rejected' | 'session.closed' }): void {
    this.registry.removeSession(session.id);
    session.client.send(signal);
    session.client.close();
  }
}
