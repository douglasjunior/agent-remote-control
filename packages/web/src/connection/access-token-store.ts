import { takeFragmentParam } from './url-fragment.js';


const DEFAULT_STORAGE_KEY = 'arc.accessToken';

/** The access token in the browser's `localStorage`, which may be blocked (private windows). */
export class AccessTokenStore {
  /** Each remote host has its own token, so the hosted web app keeps one key per instance. */
  constructor(private readonly storageKey = DEFAULT_STORAGE_KEY) {}

  read(): string | null {
    try {
      return localStorage.getItem(this.storageKey);
    } catch {
      return null;
    }
  }

  store(token: string): void {
    try {
      localStorage.setItem(this.storageKey, token);
    } catch {
      // The token then lives only until reload.
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(this.storageKey);
    } catch {
      // Nothing to clear when storage is unavailable.
    }
  }

  /** Takes a `token` parameter of the URL fragment into storage first, so a link carrying the token signs the user in. */
  load(): string | null {
    const token = takeFragmentParam('token');
    if (token) {
      this.store(token);
    }
    return this.read();
  }
}
