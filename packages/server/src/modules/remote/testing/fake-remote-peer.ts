import type { IRemoteChannel, IRemotePeer, IRemotePeerFactoryPort, RemotePeerOptions } from '../ports/remote-peer.port.js';


export class FakeRemoteChannel implements IRemoteChannel {
  readonly sent: string[] = [];
  closed = false;
  private readonly messageListeners = new Set<(text: string) => void>();
  private readonly closeListeners = new Set<() => void>();

  constructor(readonly label = 'arc') {}

  send(text: string): void {
    this.sent.push(text);
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
    this.closed = true;
  }

  receive(text: string): void {
    this.messageListeners.forEach(listener => listener(text));
  }

  emitClose(): void {
    this.closeListeners.forEach(listener => listener());
  }
}

export class FakeRemotePeer implements IRemotePeer {
  offer?: string;
  readonly candidates: [string, string][] = [];
  closed = false;
  failAnswer = false;
  private answerListener?: (sdp: string) => void;
  private candidateListener?: (candidate: string, mid: string) => void;
  private channelListener?: (channel: IRemoteChannel) => void;
  private endListener?: () => void;

  constructor(readonly options: RemotePeerOptions) {}

  answer(offerSdp: string): void {
    if (this.failAnswer) {
      throw new Error('bad offer');
    }
    this.offer = offerSdp;
  }

  addCandidate(candidate: string, mid: string): void {
    this.candidates.push([candidate, mid]);
  }

  onAnswer(listener: (sdp: string) => void): void {
    this.answerListener = listener;
  }

  onCandidate(listener: (candidate: string, mid: string) => void): void {
    this.candidateListener = listener;
  }

  onChannel(listener: (channel: IRemoteChannel) => void): void {
    this.channelListener = listener;
  }

  onEnd(listener: () => void): void {
    this.endListener = listener;
  }

  close(): void {
    this.closed = true;
  }

  emitAnswer(sdp: string): void {
    this.answerListener?.(sdp);
  }

  emitCandidate(candidate: string, mid: string): void {
    this.candidateListener?.(candidate, mid);
  }

  emitChannel(channel: IRemoteChannel): void {
    this.channelListener?.(channel);
  }

  emitEnd(): void {
    this.endListener?.();
  }
}

export class FakeRemotePeerFactory implements IRemotePeerFactoryPort {
  readonly peers: FakeRemotePeer[] = [];
  failNextAnswer = false;

  create(options: RemotePeerOptions): FakeRemotePeer {
    const peer = new FakeRemotePeer(options);
    peer.failAnswer = this.failNextAnswer;
    this.failNextAnswer = false;
    this.peers.push(peer);
    return peer;
  }
}
