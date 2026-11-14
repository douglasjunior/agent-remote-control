import { encodeBase64Url } from './base64url.js';


/** What `sessionProof` authenticates: the instance the browser reaches and the certificate it negotiates with. */
export function sessionProofMessage(instanceId: string, fingerprint: string): string {
  return `arc-session:${instanceId}:${fingerprint}`;
}

/**
 * Proves to a host that a browser holds its access token, before the host spends anything on it: HMAC-SHA256 of the
 * instance and of the certificate the browser will negotiate with, under the token. The signaling server relays it
 * without learning the token, and it is worthless with any other certificate, whose key only the browser holds.
 */
export async function sessionProof(token: string, instanceId: string, fingerprint: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(sessionProofMessage(instanceId, fingerprint)));
  return encodeBase64Url(new Uint8Array(mac));
}
