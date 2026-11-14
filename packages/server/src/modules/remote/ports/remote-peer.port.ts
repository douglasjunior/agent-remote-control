import type { IceServer } from '@agent-remote-control/protocol/signaling';


/** The data channel a browser opens to this host, carrying text messages. */
export interface IRemoteChannel {
  readonly label: string;
  send(text: string): void;
  onMessage(listener: (text: string) => void): () => void;
  onClose(listener: () => void): () => void;
  /** Closes after the messages already sent leave, so a last event still reaches the browser. */
  close(): void;
}

/** One WebRTC peer connection answering the offer of a browser. */
export interface IRemotePeer {
  answer(offerSdp: string): void;
  addCandidate(candidate: string, mid: string): void;
  onAnswer(listener: (sdp: string) => void): void;
  onCandidate(listener: (candidate: string, mid: string) => void): void;
  onChannel(listener: (channel: IRemoteChannel) => void): void;
  /** The connection failed or closed. */
  onEnd(listener: () => void): void;
  close(): void;
}

export type RemotePeerOptions = {
  readonly iceServers: readonly IceServer[];
  readonly certificatePath: string;
  readonly keyPath: string;
};

export interface IRemotePeerFactoryPort {
  create(options: RemotePeerOptions): IRemotePeer;
}

export const IRemotePeerFactoryPort = Symbol('IRemotePeerFactoryPort');
