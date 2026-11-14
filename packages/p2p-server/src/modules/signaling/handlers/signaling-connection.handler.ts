import { parseClientSignal, parseHostSignal } from '@agent-remote-control/protocol/signaling';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import type { SignalingSession } from '../models/signaling-session.model.js';
import { type ClientSocket, type HostSocket, ISignalingTransportPort } from '../ports/signaling-transport.port.js';
import { CloseClientSessionUseCase } from '../use-cases/close-client-session.use-case.js';
import { DisconnectHostUseCase } from '../use-cases/disconnect-host.use-case.js';
import { OpenClientSessionUseCase } from '../use-cases/open-client-session.use-case.js';
import { RegisterHostUseCase } from '../use-cases/register-host.use-case.js';
import { RelayClientSignalUseCase } from '../use-cases/relay-client-signal.use-case.js';
import { RelayHostSignalUseCase } from '../use-cases/relay-host-signal.use-case.js';


/** How long a socket may stay open before saying who it is. */
const FIRST_SIGNAL_TIMEOUT_MS = 5_000;
/** How long a browser may take to negotiate; once connected it needs the signaling server no more. */
const CLIENT_SESSION_TIMEOUT_MS = 60_000;
const POLICY_VIOLATION = 1008;

@Injectable()
export class SignalingConnectionHandler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SignalingConnectionHandler.name);
  private readonly unsubscribes: (() => void)[] = [];

  constructor(
    @Inject(ISignalingTransportPort) private readonly transport: ISignalingTransportPort,
    private readonly registerHost: RegisterHostUseCase,
    private readonly disconnectHost: DisconnectHostUseCase,
    private readonly relayHostSignal: RelayHostSignalUseCase,
    private readonly openClientSession: OpenClientSessionUseCase,
    private readonly relayClientSignal: RelayClientSignalUseCase,
    private readonly closeClientSession: CloseClientSessionUseCase,
  ) {}

  onModuleInit(): void {
    this.unsubscribes.push(
      this.transport.onHost(socket => this.handleHost(socket)),
      this.transport.onClient(socket => this.handleClient(socket)),
    );
  }

  onModuleDestroy(): void {
    this.unsubscribes.splice(0).forEach(unsubscribe => unsubscribe());
  }

  private handleHost(socket: HostSocket): void {
    let state: 'new' | 'registering' | 'registered' | 'closed' = 'new';
    const timer = setTimeout(() => this.reject(socket, 'no registration'), FIRST_SIGNAL_TIMEOUT_MS);

    socket.onMessage((data) => {
      const parsed = parseHostSignal(data);
      if (!parsed.ok) {
        this.reject(socket, 'invalid signal');
        return;
      }
      const signal = parsed.value;
      if (signal.type === 'host.register') {
        if (state !== 'new') {
          this.reject(socket, 'registered twice');
          return;
        }
        clearTimeout(timer);
        state = 'registering';
        void this.registerHost.execute(socket, signal).then((registered) => {
          if (state === 'closed') {
            this.disconnectHost.execute(socket);
            return;
          }
          state = registered ? 'registered' : 'closed';
        });
        return;
      }
      if (state !== 'registered') {
        this.reject(socket, 'not registered');
        return;
      }
      this.relayHostSignal.execute(socket, signal);
    });

    socket.onClose(() => {
      clearTimeout(timer);
      if (state === 'registered') {
        this.disconnectHost.execute(socket);
      }
      state = 'closed';
    });
  }

  private handleClient(socket: ClientSocket): void {
    let session: SignalingSession | undefined;
    let connected = false;
    const firstSignal = setTimeout(() => this.reject(socket, 'no connect'), FIRST_SIGNAL_TIMEOUT_MS);
    const lifetime = setTimeout(() => socket.close(), CLIENT_SESSION_TIMEOUT_MS);

    socket.onMessage((data) => {
      const parsed = parseClientSignal(data);
      if (!parsed.ok) {
        this.reject(socket, 'invalid signal');
        return;
      }
      const signal = parsed.value;
      if (signal.type === 'client.connect') {
        if (connected) {
          this.reject(socket, 'connected twice');
          return;
        }
        connected = true;
        clearTimeout(firstSignal);
        session = this.openClientSession.execute(socket, signal.instanceId);
        return;
      }
      if (!session || !this.relayClientSignal.execute(session.id, signal)) {
        this.reject(socket, `unexpected ${signal.type}`);
      }
    });

    socket.onClose(() => {
      clearTimeout(firstSignal);
      clearTimeout(lifetime);
      if (session) {
        this.closeClientSession.execute(session.id);
      }
    });
  }

  private reject(socket: HostSocket | ClientSocket, reason: string): void {
    this.logger.warn(`signal_rejected: socket=${socket.id} reason=${reason}`);
    socket.close(POLICY_VIOLATION, reason);
  }
}
