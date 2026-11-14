import { sdpFingerprint } from '@agent-remote-control/protocol/fingerprint';
import { PROTOCOL_VERSION } from '@agent-remote-control/protocol/protocol-version';
import { buildRemoteLink } from '@agent-remote-control/protocol/remote-link';
import { sessionProofMessage } from '@agent-remote-control/protocol/session-proof';
import { DATA_CHANNEL_LABEL, MAX_CANDIDATES_PER_SESSION, type ToHostSignal } from '@agent-remote-control/protocol/signaling';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { AccessTokenService } from '../../access-token/services/access-token.service.js';
import type { IClientConnection, IClientTransportPort } from '../../web/ports/client-transport.port.js';
import type { RemoteIdentity } from '../models/remote-identity.model.js';
import { type IRemotePeer, IRemotePeerFactoryPort } from '../ports/remote-peer.port.js';
import { ISignalingClientPort } from '../ports/signaling-client.port.js';
import { RemoteIdentityService } from '../services/remote-identity.service.js';

import { DataChannelClientConnection } from './data-channel-client-connection.js';


/** Sessions negotiating at once; the signaling server allows as many per instance. */
const MAX_NEGOTIATING_SESSIONS = 16;
/** A session that opens no data channel in this time, counted from its acceptance, is dropped. */
const NEGOTIATION_TIMEOUT_MS = 30_000;
/** The generated token holds 32 characters; a shorter one is too easy to guess from the Internet. */
const MIN_REMOTE_TOKEN_LENGTH = 32;
/** After a rejected proof, its source's requests wait this long, doubled per rejection in a row, unchecked. */
const REJECTION_BACKOFF_MS = 1_000;
const MAX_REJECTION_BACKOFF_MS = 30_000;
/** Sources whose rejections this host remembers; past it, the one rejected longest ago is forgotten. */
const MAX_REJECTED_SOURCES = 1_024;

type Rejections = { readonly count: number; readonly blockedUntil: number };

type RemoteSession = {
  /** The certificate the browser proved the access token for; its offer must announce it. */
  readonly fingerprint: string;
  readonly timer: ReturnType<typeof setTimeout>;
  peer?: IRemotePeer;
  candidates: number;
  connected: boolean;
};

/**
 * Browsers that reach this host through the signaling server. A browser first proves it holds the access token,
 * bound to the certificate it negotiates with; only then does this host accept the session, which hands the browser
 * the ICE servers, and answer its offer with a peer connection. The data channel goes to the web channel as one more
 * client connection, authenticated by the access token like any other.
 */
@Injectable()
export class RemoteClientTransportAdapter implements IClientTransportPort, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RemoteClientTransportAdapter.name);
  /** Its context stays out of the log files, since the link carries the access token. */
  private readonly linkLogger = new Logger('RemoteAccessLink');
  private readonly listeners = new Set<(connection: IClientConnection) => void>();
  private readonly sessions = new Map<string, RemoteSession>();
  /** By the source the signaling server gives each request, which stands for the browser's address. */
  private readonly rejections = new Map<string, Rejections>();
  private identity?: RemoteIdentity;

  constructor(
    private readonly remoteIdentity: RemoteIdentityService,
    private readonly accessToken: AccessTokenService,
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
    if (this.accessToken.token().length < MIN_REMOTE_TOKEN_LENGTH) {
      this.logger.error(`Remote access off: the access token must hold at least ${MIN_REMOTE_TOKEN_LENGTH} characters; leave WEB_ACCESS_TOKEN empty to generate one`);
      return;
    }
    const baseUrl = this.remoteIdentity.baseUrl();
    if (!baseUrl) {
      this.logger.error('Remote access off: REMOTE_URL must hold the HTTPS URL of a signaling server you trust (HTTP only for localhost)');
      return;
    }
    const identity = await this.remoteIdentity.identity();
    this.identity = identity;
    const { instanceId, certificate, fingerprint } = identity;
    this.signaling.start({
      url: this.remoteIdentity.signalingUrl(baseUrl),
      register: async nonce => ({
        type: 'host.register',
        instanceId,
        certificate,
        signature: await this.remoteIdentity.signChallenge(nonce),
        protocolVersion: PROTOCOL_VERSION,
      }),
      onSignal: signal => this.handleSignal(signal),
    });
    this.linkLogger.log(`Remote access link: ${buildRemoteLink(baseUrl, instanceId, fingerprint, this.accessToken.token())}`);
  }

  onModuleDestroy(): void {
    this.signaling.stop();
    [...this.sessions.keys()].forEach(sessionId => this.end(sessionId));
  }

  /** A signal that fails gives up its session only: the input comes from browsers this host does not trust yet. */
  private handleSignal(signal: ToHostSignal): void {
    try {
      this.apply(signal);
    } catch (error) {
      this.logger.warn(`remote_signal_failed: ${signal.type}: ${error instanceof Error ? error.message : String(error)}`);
      if ('sessionId' in signal) {
        this.giveUp(signal.sessionId);
      }
    }
  }

  private apply(signal: ToHostSignal): void {
    switch (signal.type) {
      case 'session.request':
        this.decide(signal);
        return;
      case 'session.offer':
        this.answer(signal);
        return;
      case 'session.candidate': {
        const session = this.sessions.get(signal.sessionId);
        if (session?.peer && session.candidates < MAX_CANDIDATES_PER_SESSION) {
          session.candidates += 1;
          session.peer.addCandidate(signal.candidate, signal.mid);
        }
        return;
      }
      case 'session.closed':
        if (this.sessions.get(signal.sessionId)?.connected === false) {
          this.end(signal.sessionId);
        }
    }
  }

  /**
   * Accepts a session whose proof holds, while this host negotiates fewer than its limit. A wrong proof is a guess at
   * the access token, so each rejection in a row makes the following requests of its source wait longer before being
   * checked. Backing off per source keeps whoever guesses from locking out everybody else.
   */
  private decide({ sessionId, source, fingerprint, proof }: Extract<ToHostSignal, { type: 'session.request' }>): void {
    const negotiating = [...this.sessions.values()].filter(session => !session.connected).length;
    const rejected = this.rejections.get(source);
    if ((rejected && Date.now() < rejected.blockedUntil) || negotiating >= MAX_NEGOTIATING_SESSIONS || this.sessions.has(sessionId)) {
      this.signaling.send({ type: 'host.close', sessionId });
      return;
    }
    if (!this.provesToken(fingerprint, proof)) {
      this.reject(source, (rejected?.count ?? 0) + 1);
      this.signaling.send({ type: 'host.reject', sessionId });
      return;
    }
    this.rejections.delete(source);
    const timer = setTimeout(() => this.giveUp(sessionId), NEGOTIATION_TIMEOUT_MS);
    this.sessions.set(sessionId, { fingerprint, timer, candidates: 0, connected: false });
    this.signaling.send({ type: 'host.accept', sessionId });
  }

  private reject(source: string, count: number): void {
    this.rejections.delete(source);
    this.rejections.set(source, {
      count,
      blockedUntil: Date.now() + Math.min(REJECTION_BACKOFF_MS * 2 ** (count - 1), MAX_REJECTION_BACKOFF_MS),
    });
    if (this.rejections.size > MAX_REJECTED_SOURCES) {
      this.rejections.delete(this.rejections.keys().next().value!);
    }
    this.logger.warn(`remote_session_rejected: rejections=${count}`);
  }

  /** Compares the canonical base64url text, so an encoding that differs only in its padding bits is refused too. */
  private provesToken(fingerprint: string, proof: string): boolean {
    const expected = Buffer.from(createHmac('sha256', this.accessToken.token())
      .update(sessionProofMessage(this.identity!.instanceId, fingerprint))
      .digest('base64url'));
    const received = Buffer.from(proof);
    return received.length === expected.length && timingSafeEqual(received, expected);
  }

  /** Answers the offer of an accepted session, when it announces the certificate the browser proved the token for. */
  private answer({ sessionId, sdp, iceServers }: Extract<ToHostSignal, { type: 'session.offer' }>): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.peer || sdpFingerprint(sdp) !== session.fingerprint) {
      this.giveUp(sessionId);
      return;
    }
    const { certificatePath, keyPath } = this.identity!;
    const peer = this.peers.create({ iceServers, certificatePath, keyPath });
    session.peer = peer;
    peer.onAnswer(answer => this.signaling.send({ type: 'host.answer', sessionId, sdp: answer }));
    peer.onCandidate((candidate, mid) => this.signaling.send({ type: 'host.candidate', sessionId, candidate, mid }));
    peer.onEnd(() => this.end(sessionId));
    peer.onChannel((channel) => {
      if (session.connected || channel.label !== DATA_CHANNEL_LABEL) {
        channel.close();
        return;
      }
      session.connected = true;
      clearTimeout(session.timer);
      const connection = new DataChannelClientConnection(channel);
      connection.onClose(() => this.end(sessionId));
      this.listeners.forEach(listener => listener(connection));
    });
    peer.answer(sdp);
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
    session.peer?.close();
  }
}
