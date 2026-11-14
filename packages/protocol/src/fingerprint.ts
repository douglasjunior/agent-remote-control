import { encodeBase64Url } from './base64url.js';


/** A SHA-256 certificate fingerprint as base64url: 32 bytes in 43 characters. */
export const FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A SHA-256 certificate fingerprint as written in SDP (`AB:CD:…`) turned into base64url, short enough for a link. */
export function encodeFingerprint(hex: string): string {
  return encodeBase64Url(Uint8Array.from(hex.split(':'), pair => Number.parseInt(pair, 16)));
}

/**
 * The SHA-256 certificate fingerprint an SDP announces, as base64url. Null unless every `a=fingerprint` line names
 * that same SHA-256 fingerprint: a DTLS stack may pin the handshake to any of the lines, whatever their algorithm
 * (libdatachannel takes the first one).
 */
export function sdpFingerprint(sdp: string): string | null {
  const values = new Set(Array.from(sdp.matchAll(/^a=fingerprint:.*$/gim), ([line]) =>
    /^a=fingerprint:sha-256 ((?:[0-9a-f]{2}:){31}[0-9a-f]{2})\s*$/i.exec(line)?.[1].toUpperCase()));
  const [value] = values;
  return values.size === 1 && value !== undefined ? encodeFingerprint(value) : null;
}
