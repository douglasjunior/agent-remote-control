const STORAGE_KEY = 'arc.accessToken';
const FRAGMENT_PREFIX = '#token=';

export function readAccessToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeAccessToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Storage can be blocked (private windows); the token then lives only until reload.
  }
}

export function clearAccessToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

/** Reads a `#token=` URL fragment into storage and strips it from the address bar. */
function consumeFragmentToken(): void {
  if (!location.hash.startsWith(FRAGMENT_PREFIX)) {
    return;
  }
  const token = decodeURIComponent(location.hash.slice(FRAGMENT_PREFIX.length));
  history.replaceState(null, '', location.pathname + location.search);
  if (token) {
    storeAccessToken(token);
  }
}

export function loadAccessToken(): string | null {
  consumeFragmentToken();
  return readAccessToken();
}
