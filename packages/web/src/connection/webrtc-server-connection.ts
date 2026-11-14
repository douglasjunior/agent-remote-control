import { FrameAssembler, toFrames } from '@agent-remote-control/protocol/data-channel-frames';
import { sdpFingerprint } from '@agent-remote-control/protocol/fingerprint';
import { PROTOCOL_VERSION } from '@agent-remote-control/protocol/protocol-version';
import {
  type ClientSignal,
  DATA_CHANNEL_LABEL,
  type IceServer,
  parseToClientSignal,
  SIGNALING_CLIENT_PATH,
  type ToClientSignal,
} from '@agent-remote-control/protocol/signaling';

import type { AccessTokenStore } from './access-token-store.js';
import { ChannelServerConnection, type ChannelCloseReason, type ChannelHandlers, type ServerChannel } from './channel-server-connection.js';
import type { RemoteLink } from './remote-link.js';


/** A conversation history arrives as one event, so a message from the host may be large. */
const MAX_EVENT_LENGTH = 64 * 1024 * 1024;

/**
 * Reaches a host from anywhere: the signaling server of the page introduces the browser to the host and a WebRTC
 * data channel carries the messages, in frames. The host must present the certificate the link pinned.
 */
export class WebRtcServerConnection extends ChannelServerConnection {
  constructor(tokens: AccessTokenStore, private readonly link: RemoteLink) {
    super(tokens, 'webrtc');
  }

  protected openChannel(handlers: ChannelHandlers): ServerChannel {
    return new PeerChannel(this.link, handlers);
  }
}

class PeerChannel implements ServerChannel {
  private readonly signaling: WebSocket;
  private readonly assembler = new FrameAssembler(MAX_EVENT_LENGTH);
  private peer: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private ended = false;

  constructor(private readonly link: RemoteLink, private readonly handlers: ChannelHandlers) {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    this.signaling = new WebSocket(`${protocol}://${location.host}${SIGNALING_CLIENT_PATH}`);
    this.signaling.onopen = () => this.signal({ type: 'client.connect', instanceId: link.instanceId });
    this.signaling.onmessage = message => this.handleSignal(String(message.data)).catch(() => this.fail('closed'));
    this.signaling.onclose = () => {
      if (!this.isOpen()) {
        this.fail('closed');
      }
    };
  }

  send(text: string): void {
    toFrames(text).forEach(frame => this.dataChannel?.send(frame));
  }

  close(): void {
    this.ended = true;
    this.release();
  }

  private async handleSignal(text: string): Promise<void> {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    const parsed = parseToClientSignal(data);
    if (!parsed.ok) {
      console.warn('Dropped an invalid signal', parsed.error);
      return;
    }
    await this.apply(parsed.value);
  }

  private async apply(signal: ToClientSignal): Promise<void> {
    switch (signal.type) {
      case 'client.accepted':
        await this.offer(signal.iceServers, signal.protocolVersion);
        return;
      case 'session.answer':
        await this.accept(signal.sdp);
        return;
      case 'session.candidate':
        await this.peer?.addIceCandidate({ candidate: signal.candidate, sdpMid: signal.mid });
        return;
      default:
        if (!this.isOpen()) {
          this.fail('closed');
        }
    }
  }

  private async offer(iceServers: IceServer[], protocolVersion: number): Promise<void> {
    if (protocolVersion !== PROTOCOL_VERSION) {
      this.fail('incompatible');
      return;
    }
    const peer = new RTCPeerConnection({ iceServers });
    const channel = peer.createDataChannel(DATA_CHANNEL_LABEL);
    this.peer = peer;
    this.dataChannel = channel;
    peer.onicecandidate = ({ candidate }) => {
      if (candidate?.candidate) {
        this.signal({ type: 'client.candidate', candidate: candidate.candidate, mid: candidate.sdpMid ?? '0' });
      }
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
        this.fail('closed');
      }
    };
    channel.onopen = () => {
      this.signaling.close();
      this.handlers.onOpen();
      void this.reportTransport(peer);
    };
    channel.onmessage = message => this.receive(String(message.data));
    channel.onclose = () => this.fail('closed');
    const description = await peer.createOffer();
    await peer.setLocalDescription(description);
    this.signal({ type: 'client.offer', sdp: description.sdp ?? '' });
  }

  /** Refuses an answer whose certificate is not the pinned one: whoever answers would read the access token. */
  private async accept(sdp: string): Promise<void> {
    if (sdpFingerprint(sdp) !== this.link.fingerprint) {
      this.fail('untrusted');
      return;
    }
    await this.peer?.setRemoteDescription({ type: 'answer', sdp });
  }

  private receive(frame: string): void {
    const result = this.assembler.push(frame);
    if (result.kind === 'message') {
      this.handlers.onMessage(result.text);
    }
    if (result.kind === 'invalid') {
      console.warn('Dropped a connection sending invalid frames', result.reason);
      this.fail('closed');
    }
  }

  /** A relayed candidate on either end of the selected pair means a TURN server carries the traffic. */
  private async reportTransport(peer: RTCPeerConnection): Promise<void> {
    const stats = await peer.getStats();
    const pair = selectedCandidatePair(stats);
    const relayed = [pair?.localCandidateId, pair?.remoteCandidateId]
      .some(id => id !== undefined && (stats.get(id) as { candidateType?: string } | undefined)?.candidateType === 'relay');
    this.handlers.onTransport(relayed ? 'turn' : 'webrtc');
  }

  private signal(signal: ClientSignal): void {
    if (this.signaling.readyState === WebSocket.OPEN) {
      this.signaling.send(JSON.stringify(signal));
    }
  }

  private isOpen(): boolean {
    return this.dataChannel?.readyState === 'open';
  }

  private fail(reason: ChannelCloseReason): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.release();
    this.handlers.onClose(reason);
  }

  private release(): void {
    this.signaling.close();
    this.dataChannel?.close();
    this.peer?.close();
  }
}

type CandidatePair = { readonly localCandidateId?: string; readonly remoteCandidateId?: string };

/** The pair the transport selected (Chromium, Safari) or the one flagged `selected` (Firefox). */
function selectedCandidatePair(stats: RTCStatsReport): CandidatePair | undefined {
  const reports = [...stats.values()] as { type: string; id: string; selectedCandidatePairId?: string; selected?: boolean }[];
  const pairId = reports.find(report => report.type === 'transport' && report.selectedCandidatePairId)?.selectedCandidatePairId;
  const pair = pairId ? stats.get(pairId) : reports.find(report => report.type === 'candidate-pair' && report.selected);
  return pair as CandidatePair | undefined;
}
