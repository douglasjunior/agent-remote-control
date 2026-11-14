/** What makes this host reachable through the signaling server and recognizable by the browsers that pin it. */
export type RemoteIdentity = {
  /** Derived from the fingerprint, so registering it takes the certificate's key. */
  readonly instanceId: string;
  /** SHA-256 fingerprint of the DTLS certificate, base64url, carried by the remote link. */
  readonly fingerprint: string;
  /** The DER certificate, base64, which the signaling server checks a registration against. */
  readonly certificate: string;
  readonly certificatePath: string;
  readonly keyPath: string;
};
