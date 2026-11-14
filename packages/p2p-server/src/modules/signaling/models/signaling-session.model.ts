import type { ClientSocket, HostSocket } from '../ports/signaling-transport.port.js';


export type RegisteredHost = {
  readonly instanceId: string;
  readonly socket: HostSocket;
  readonly protocolVersion: number;
};

/** One browser negotiating a connection to a host; it ends when the browser closes its signaling socket. */
export type SignalingSession = {
  readonly id: string;
  readonly instanceId: string;
  readonly client: ClientSocket;
  /** Candidates are relayed only after the offer, which the host needs first. */
  readonly offered: boolean;
};
