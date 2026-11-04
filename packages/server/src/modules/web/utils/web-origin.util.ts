export function parseAllowedOrigins(raw: string | undefined): ReadonlySet<string> {
  const origins = (raw ?? '')
    .split(',')
    .map(origin => origin.trim().replace(/\/+$/, ''))
    .filter(origin => origin.length > 0);
  return new Set(origins);
}

/** An absent or malformed `Origin` is rejected: browsers always send it on a WebSocket upgrade. */
export function isOriginAllowed(
  origin: string | undefined,
  host: string | undefined,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  if (!origin) {
    return false;
  }
  if (allowedOrigins.has(origin)) {
    return true;
  }
  try {
    return host !== undefined && new URL(origin).host === host;
  } catch {
    return false;
  }
}
