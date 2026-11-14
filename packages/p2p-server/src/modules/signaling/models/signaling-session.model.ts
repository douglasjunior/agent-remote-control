import type { ClientSocket, HostSocket } from '../ports/signaling-transport.port.js';


export type RegisteredHost = {
  readonly instanceId: string;
  readonly socket: HostSocket;
  readonly protocolVersion: number;
};

/**
 * `requested`: the host checks the browser's proof. `accepted`: the browser holds the ICE servers and may offer.
 * `offered`: the host has the offer, which it needs before any candidate.
 */
export type SignalingSessionState = 'requested' | 'accepted' | 'offered';

/** One browser negotiating a connection to a host; it ends when the browser closes its signaling socket. */
export type SignalingSession = {
  readonly id: string;
  readonly instanceId: string;
  readonly client: ClientSocket;
  /** The certificate the browser proved its access token for; its offer must announce it. */
  readonly fingerprint: string;
  readonly state: SignalingSessionState;
  /** Candidates relayed from the browser to the host. */
  readonly candidates: number;
};
