import { PROTOCOL_VERSION } from '@agent-remote-control/protocol/protocol-version';
import { DATA_CHANNEL_LABEL, type ToHostSignal } from '@agent-remote-control/protocol/signaling';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';

import type { IClientConnection, IClientTransportPort } from '../../web/ports/client-transport.port.js';
import type { RemoteIdentity } from '../models/remote-identity.model.js';
import { type IRemotePeer, IRemotePeerFactoryPort } from '../ports/remote-peer.port.js';
import { ISignalingClientPort } from '../ports/signaling-client.port.js';
import { RemoteIdentityService } from '../services/remote-identity.service.js';

import { DataChannelClientConnection } from './data-channel-client-connection.js';


/** Peer connections negotiating at once; the signaling server allows as many sessions per instance. */
const MAX_NEGOTIATING_PEERS = 16;
/** A peer that opens no data channel in this time is dropped. */
const NEGOTIATION_TIMEOUT_MS = 30_000;

type RemoteSession = {
  readonly peer: IRemotePeer;
  readonly timer: ReturnType<typeof setTimeout>;
  connected: boolean;
};

/**
 * Browsers that reach this host through the signaling server: answers each offer with a peer connection and hands
 * its data channel to the web channel as one more client connection, authenticated by the access token like any other.
 */
@Injectable()
export class RemoteClientTransportAdapter implements IClientTransportPort, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RemoteClientTransportAdapter.name);
  private readonly listeners = new Set<(connection: IClientConnection) => void>();
  private readonly sessions = new Map<string, RemoteSession>();
  private identity?: RemoteIdentity;

  constructor(
    private readonly remoteIdentity: RemoteIdentityService,
    @Inject(ISignalingClientPort) private readonly signaling: ISignalingClientPort,
    @Inject(IRemotePeerFactoryPort) private readonly peers: IRemotePeerFactoryPort,
  ) {}

  onConnection(listener: (connection: IClientConnection) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.remoteIdentity.isEnabled()) {
      return;
    }
    this.identity = await this.remoteIdentity.identity();
    const { instanceId, secret } = this.identity;
    this.signaling.start({
      url: this.remoteIdentity.signalingUrl(),
      registration: { type: 'host.register', instanceId, secret, protocolVersion: PROTOCOL_VERSION },
      onSignal: signal => this.handleSignal(signal),
    });
  }

  onModuleDestroy(): void {
    this.signaling.stop();
    [...this.sessions.keys()].forEach(sessionId => this.end(sessionId));
  }

  private handleSignal(signal: ToHostSignal): void {
    if (signal.type === 'session.offer') {
      this.answer(signal);
      return;
    }
    if (signal.type === 'session.candidate') {
      this.sessions.get(signal.sessionId)?.peer.addCandidate(signal.candidate, signal.mid);
      return;
    }
    if (signal.type === 'session.closed' && this.sessions.get(signal.sessionId)?.connected === false) {
      this.end(signal.sessionId);
    }
  }

  private answer({ sessionId, sdp, iceServers }: Extract<ToHostSignal, { type: 'session.offer' }>): void {
    const negotiating = [...this.sessions.values()].filter(session => !session.connected).length;
    if (negotiating >= MAX_NEGOTIATING_PEERS || this.sessions.has(sessionId)) {
      this.signaling.send({ type: 'host.close', sessionId });
      return;
    }
    const { certificatePath, keyPath } = this.identity!;
    const peer = this.peers.create({ iceServers, certificatePath, keyPath });
    const timer = setTimeout(() => this.giveUp(sessionId), NEGOTIATION_TIMEOUT_MS);
    const session: RemoteSession = { peer, timer, connected: false };
    this.sessions.set(sessionId, session);
    peer.onAnswer(answer => this.signaling.send({ type: 'host.answer', sessionId, sdp: answer }));
    peer.onCandidate((candidate, mid) => this.signaling.send({ type: 'host.candidate', sessionId, candidate, mid }));
    peer.onEnd(() => this.end(sessionId));
    peer.onChannel((channel) => {
      if (session.connected || channel.label !== DATA_CHANNEL_LABEL) {
        channel.close();
        return;
      }
      session.connected = true;
      clearTimeout(timer);
      const connection = new DataChannelClientConnection(channel);
      connection.onClose(() => this.end(sessionId));
      this.listeners.forEach(listener => listener(connection));
    });
    try {
      peer.answer(sdp);
    } catch (error) {
      this.logger.warn(`remote_offer_rejected: ${error instanceof Error ? error.message : String(error)}`);
      this.giveUp(sessionId);
    }
  }

  private giveUp(sessionId: string): void {
    this.end(sessionId);
    this.signaling.send({ type: 'host.close', sessionId });
  }

  private end(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    this.sessions.delete(sessionId);
    clearTimeout(session.timer);
    session.peer.close();
  }
}
