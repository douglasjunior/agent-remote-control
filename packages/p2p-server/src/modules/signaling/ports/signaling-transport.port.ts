import type { ToClientSignal, ToHostSignal } from '@agent-remote-control/protocol/signaling';


export interface ISignalingSocket<TSignal> {
  readonly id: string;
  /** The address the socket comes from, the client's when trusted proxies stand in front of the server. */
  readonly address: string;
  send(signal: TSignal): void;
  /** Delivers each message as parsed JSON, or as the raw text when it is not JSON. */
  onMessage(listener: (data: unknown) => void): () => void;
  onClose(listener: () => void): () => void;
  close(code?: number, reason?: string): void;
}

export type HostSocket = ISignalingSocket<ToHostSignal>;
export type ClientSocket = ISignalingSocket<ToClientSignal>;

export interface ISignalingTransportPort {
  onHost(listener: (socket: HostSocket) => void): () => void;
  onClient(listener: (socket: ClientSocket) => void): () => void;
}

export const ISignalingTransportPort = Symbol('ISignalingTransportPort');
