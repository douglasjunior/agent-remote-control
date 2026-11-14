/** The path of the hosted web app for one host: `/i/<instance id>`, the base of every route of the app. */
export const REMOTE_INSTANCE_PATH_PREFIX = '/i/';
const INSTANCE_ID_LENGTH = 20;

/** The public id of a host: derived from its secret, so registering an instance proves holding its secret. */
export async function deriveInstanceId(secret: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('').slice(0, INSTANCE_ID_LENGTH);
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
