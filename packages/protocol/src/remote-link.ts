import { decodeBase64Url } from './base64url.js';
import { FINGERPRINT_PATTERN } from './fingerprint.js';


/** The path of the hosted web app for one host: `/i/<instance id>`, the base of every route of the app. */
export const REMOTE_INSTANCE_PATH_PREFIX = '/i/';
const INSTANCE_ID_BYTES = 10;

/**
 * The public id of a host: the first 10 bytes of the SHA-256 fingerprint of its certificate, in hex. Registering an
 * instance then takes the certificate's key, and a link cannot pair an instance with another certificate.
 */
export function deriveInstanceId(fingerprint: string): string {
  return Array.from(decodeBase64Url(fingerprint).subarray(0, INSTANCE_ID_BYTES), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Whether the base64url fingerprint is one of the certificate that derives the instance id. */
export function isFingerprintOf(instanceId: string, fingerprint: string): boolean {
  return FINGERPRINT_PATTERN.test(fingerprint) && deriveInstanceId(fingerprint) === instanceId;
}

/**
 * The link a host prints to be reached from anywhere. The certificate fingerprint and the access token travel in the
 * fragment, which the browser never sends to the server that hosts the page.
 */
export function buildRemoteLink(baseUrl: string, instanceId: string, fingerprint: string, token: string): string {
  const fragment = new URLSearchParams({ fp: fingerprint, token });
  return `${baseUrl.replace(/\/+$/, '')}${REMOTE_INSTANCE_PATH_PREFIX}${instanceId}#${fragment.toString()}`;
}

/** The instance id at the start of a path of the hosted web app, or null outside `/i/<instance id>`. */
export function instanceIdFromPath(pathname: string): string | null {
  const match = /^\/i\/([0-9a-f]{20})(?:\/|$)/.exec(pathname);
  return match ? match[1] : null;
}
