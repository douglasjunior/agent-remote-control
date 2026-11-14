/** What makes this host reachable through the signaling server and recognizable by the browsers that pin it. */
export type RemoteIdentity = {
  readonly instanceId: string;
  /** Proves the instance to the signaling server; never leaves the host otherwise. */
  readonly secret: string;
  /** SHA-256 fingerprint of the DTLS certificate, base64url, carried by the remote link. */
  readonly fingerprint: string;
  readonly certificatePath: string;
  readonly keyPath: string;
};
