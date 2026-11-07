const STORAGE_KEY = 'arc.accessToken';
const FRAGMENT_PREFIX = '#token=';

/** The access token in the browser's `localStorage`, which may be blocked (private windows). */
export class AccessTokenStore {
  read(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  store(token: string): void {
    try {
      localStorage.setItem(STORAGE_KEY, token);
    } catch {
      // The token then lives only until reload.
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clear when storage is unavailable.
    }
  }

  /** Takes a `#token=` URL fragment into storage first, so a link carrying the token signs the user in. */
  load(): string | null {
    this.consumeFragmentToken();
    return this.read();
  }

  /** Reads the `#token=` fragment into storage and strips it from the address bar. */
  private consumeFragmentToken(): void {
    if (!location.hash.startsWith(FRAGMENT_PREFIX)) {
      return;
    }
    const token = decodeURIComponent(location.hash.slice(FRAGMENT_PREFIX.length));
    history.replaceState(null, '', location.pathname + location.search);
    if (token) {
      this.store(token);
    }
  }
}
