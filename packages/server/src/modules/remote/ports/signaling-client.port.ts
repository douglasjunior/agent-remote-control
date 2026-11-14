import type { HostSignal, ToHostSignal } from '@agent-remote-control/protocol/signaling';


export type HostRegistration = Extract<HostSignal, { type: 'host.register' }>;

export type SignalingClientOptions = {
  readonly url: string;
  /** The registration answering the nonce of the challenge each new socket gets. */
  readonly register: (nonce: string) => Promise<HostRegistration>;
  /** Every signal after the challenge. */
  readonly onSignal: (signal: ToHostSignal) => void;
};

/** The socket this host keeps open to the signaling server, registering again on every reconnection. */
export interface ISignalingClientPort {
  start(options: SignalingClientOptions): void;
  send(signal: HostSignal): void;
  stop(): void;
}

export const ISignalingClientPort = Symbol('ISignalingClientPort');
