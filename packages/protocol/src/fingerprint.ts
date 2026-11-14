import { encodeBase64Url } from './base64url.js';


/** A SHA-256 certificate fingerprint as base64url: 32 bytes in 43 characters. */
export const FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A SHA-256 certificate fingerprint as written in SDP (`AB:CD:…`) turned into base64url, short enough for a link. */
export function encodeFingerprint(hex: string): string {
  return encodeBase64Url(Uint8Array.from(hex.split(':'), pair => Number.parseInt(pair, 16)));
}

/**
 * The SHA-256 certificate fingerprint an SDP announces, as base64url. Null when it announces none or more than one,
 * since the DTLS handshake then cannot be pinned to a single certificate.
 */
export function sdpFingerprint(sdp: string): string | null {
  const values = new Set(
    Array.from(sdp.matchAll(/^a=fingerprint:sha-256 ((?:[0-9a-f]{2}:){31}[0-9a-f]{2})\s*$/gim), match => match[1].toUpperCase()),
  );
  return values.size === 1 ? encodeFingerprint([...values][0]) : null;
}
