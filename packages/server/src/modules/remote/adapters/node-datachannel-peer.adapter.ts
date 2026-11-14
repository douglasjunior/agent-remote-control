import type { IceServer } from '@agent-remote-control/protocol/signaling';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import nodeDataChannel, { type DataChannel, type IceServer as NodeIceServer, type PeerConnection } from 'node-datachannel';
import { randomUUID } from 'node:crypto';

import type { IRemoteChannel, IRemotePeer, IRemotePeerFactoryPort, RemotePeerOptions } from '../ports/remote-peer.port.js';


const RELAY_TYPES = { udp: 'TurnUdp', tcp: 'TurnTcp' } as const;

class NodeDataChannelChannel implements IRemoteChannel {
  private readonly messageListeners = new Set<(text: string) => void>();
  private readonly closeListeners = new Set<() => void>();

  constructor(private readonly channel: DataChannel) {
    channel.onMessage((message) => {
      const text = typeof message === 'string' ? message : Buffer.from(message as ArrayBuffer).toString('utf8');
      this.messageListeners.forEach(listener => listener(text));
    });
    channel.onClosed(() => this.closeListeners.forEach(listener => listener()));
  }

  get label(): string {
    return this.channel.getLabel();
  }

  send(text: string): void {
    if (this.channel.isOpen()) {
      this.channel.sendMessage(text);
    }
  }

  onMessage(listener: (text: string) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(): void {
    if (!this.channel.isOpen() || this.channel.bufferedAmount() === 0) {
      this.channel.close();
      return;
    }
    this.channel.setBufferedAmountLowThreshold(0);
    this.channel.onBufferedAmountLow(() => this.channel.close());
  }
}

class NodeDataChannelPeer implements IRemotePeer {
  private ended = false;
  private endListener?: () => void;

  constructor(private readonly peer: PeerConnection) {
    peer.onStateChange((state) => {
      if (state === 'failed' || state === 'closed') {
        this.end();
      }
    });
  }

  answer(offerSdp: string): void {
    this.peer.setRemoteDescription(offerSdp, 'offer');
  }

  addCandidate(candidate: string, mid: string): void {
    this.peer.addRemoteCandidate(candidate, mid);
  }

  onAnswer(listener: (sdp: string) => void): void {
    this.peer.onLocalDescription(sdp => listener(sdp));
  }

  onCandidate(listener: (candidate: string, mid: string) => void): void {
    this.peer.onLocalCandidate(listener);
  }

  onChannel(listener: (channel: IRemoteChannel) => void): void {
    this.peer.onDataChannel(channel => listener(new NodeDataChannelChannel(channel)));
  }

  onEnd(listener: () => void): void {
    this.endListener = listener;
  }

  close(): void {
    this.peer.close();
    this.end();
  }

  private end(): void {
    if (!this.ended) {
      this.ended = true;
      this.endListener?.();
    }
  }
}

/** WebRTC through libdatachannel, answering browsers with the DTLS certificate the remote link pins. */
@Injectable()
export class NodeDataChannelPeerAdapter implements IRemotePeerFactoryPort, OnApplicationShutdown {
  create({ iceServers, certificatePath, keyPath }: RemotePeerOptions): IRemotePeer {
    const peer = new nodeDataChannel.PeerConnection(`arc-${randomUUID()}`, {
      iceServers: iceServers.flatMap(server => server.urls.map(url => this.toNodeIceServer(url, server))),
      certificatePemFile: certificatePath,
      keyPemFile: keyPath,
    });
    return new NodeDataChannelPeer(peer);
  }

  onApplicationShutdown(): void {
    nodeDataChannel.cleanup();
  }

  /** libdatachannel takes a STUN URL as is and a TURN server as an object, whose username may hold a colon. */
  private toNodeIceServer(url: string, server: IceServer): string | NodeIceServer {
    const turn = /^(turns?):([^:?]+)(?::(\d+))?(?:\?transport=(udp|tcp))?$/.exec(url);
    if (!turn) {
      return url;
    }
    const [, scheme, hostname, port, transport] = turn;
    return {
      hostname,
      port: Number(port ?? (scheme === 'turns' ? 5349 : 3478)),
      username: server.username,
      password: server.credential,
      relayType: scheme === 'turns' ? 'TurnTls' : RELAY_TYPES[transport as keyof typeof RELAY_TYPES ?? 'udp'],
    };
  }
}
