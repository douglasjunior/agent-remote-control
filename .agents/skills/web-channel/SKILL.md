---
name: web-channel
description: >
  Web interface channel of the server: the IClientTransportPort transport port and its WebSocket
  adapter, the authentication gate with the access token, the origin check against cross-site
  WebSocket hijacking, connection registry, the /health route and the WEB_* environment
  variables. Use when working with the web module, WebSocket connections, the access token or
  allowed origins.
---

# Web channel

> **Maintaining this skill**
>
> Update this document whenever any rule described here changes. The criterion is not
> *which* rule — it is the nature of the change: a transport, authentication, origin or
> serving rule changed → update; a technical refactor that preserves the described behavior →
> leave it alone.

The `WebModule` lives in `packages/server/src/modules/web/`. Anyone who can talk to its socket runs
agents with full autonomy on the host, so every rule below exists to keep that socket reachable only
by the owner. The message contract is the `@agent-remote-control/protocol` package.

## Transport port

- `IClientTransportPort` (`onConnection`) and `IClientConnection` (`send`, `onMessage`, `onClose`,
  `close`) hide the technology, so a WebRTC DataChannel can replace WebSocket.
- `onMessage` delivers parsed JSON, or the raw value when the payload is not JSON. The transport only
  serializes `ServerEvent`; validating commands belongs to the handler through `parseClientCommand`.
- `WsClientTransportAdapter` uses `ws` with `WebSocketServer({ noServer: true })` attached to the
  `upgrade` event of the Nest HTTP server. It accepts the path `/ws` only and destroys the socket of any
  other upgrade. It enforces a 256 KiB payload limit and closes the server on module destroy.

## Origin check

- The upgrade is accepted when the `Origin` host equals the request `Host`, or when the origin is listed
  in `WEB_ALLOWED_ORIGINS` (comma-separated, compared without a trailing slash).
- A missing or malformed `Origin` is rejected. Rejection answers `403` and destroys the socket.
- During development the Vite origin (`http://localhost:5173`) goes in `WEB_ALLOWED_ORIGINS`.

## Access token and auth gate

- `WebAccessTokenService` takes the token from `WEB_ACCESS_TOKEN`, otherwise from
  `<DATA_DIR>/web/access-token`, generated once with `randomBytes(24).toString('base64url')` and file
  mode `0o600`. `verify` compares with `timingSafeEqual` and returns false on a length mismatch.
- On bootstrap it logs `Web interface access token: <token>`.
- `WebConnectionHandler` waits at most 5 s for an `auth` command on each connection. A wrong token, any
  other first command or a timeout sends `auth.failed` and closes with code `4401`. Commands from a
  connection that has not authenticated are never routed.
- A correct token sends `auth.ok` and registers the connection in `WebConnectionRegistryService`, which
  removes it on close and offers `broadcast(event)`.
- Invalid commands from an authenticated connection answer an `error` event.

## Health

`GET /health` belongs to `AppController`. The server does not serve the web interface: it is a separate
app (Vite dev server or preview locally, nginx in production) that reaches the server through the
WebSocket, so its origin must be listed in `WEB_ALLOWED_ORIGINS`.

## Environment

`WEB_ENABLED` (default `true`; `false` leaves `WebModule` out of `AppModule`), `WEB_ACCESS_TOKEN`
and `WEB_ALLOWED_ORIGINS`.
