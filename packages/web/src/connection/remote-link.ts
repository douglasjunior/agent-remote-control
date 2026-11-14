import { instanceIdFromPath, isFingerprintOf } from '@agent-remote-control/protocol/remote-link';

import { takeFragmentParam } from './url-fragment.js';


/** The host the hosted web app reaches, and the fingerprint of the certificate it must present. */
export type RemoteLink = {
  readonly instanceId: string;
  readonly fingerprint: string;
};

/**
 * The host of this page: its instance id from the path (`/i/<instance id>`) and the fingerprint the link pinned in
 * the `fp` fragment parameter, kept per instance so a reload or a later visit still checks it. The instance id
 * derives from the fingerprint, so a link pairing an instance with another certificate is ignored. Null without both.
 */
export function readRemoteLink(): RemoteLink | null {
  const instanceId = instanceIdFromPath(location.pathname);
  if (!instanceId) {
    return null;
  }
  const storageKey = `arc.remote.${instanceId}.fingerprint`;
  const linked = takeFragmentParam('fp');
  const fromLink = linked && isFingerprintOf(instanceId, linked) ? linked : null;
  if (fromLink) {
    try {
      localStorage.setItem(storageKey, fromLink);
    } catch {
      return { instanceId, fingerprint: fromLink };
    }
  }
  const stored = readStored(storageKey);
  const fingerprint = fromLink ?? (stored && isFingerprintOf(instanceId, stored) ? stored : null);
  return fingerprint ? { instanceId, fingerprint } : null;
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
