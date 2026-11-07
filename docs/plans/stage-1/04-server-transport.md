# 04 — Server: transport and auth

**Model:** Sonnet 5.5 · **Effort:** high · **Depends on:** 03

## Goal

Add the `web` module to the server with the transport layer only: a WebSocket endpoint behind a transport port, and authenticated connections. The server does not serve the web interface: it is a separate app (Vite dev server or `vite preview` locally, nginx in production) that reaches the socket through a same-origin `/ws` proxy or a listed origin. Conversations come in plan 05.

**Why this plan is security-sensitive.** Anyone who can talk to this socket runs agents with full autonomy on the host. Two threats drive the design:

- **Cross-site WebSocket hijacking:** any website the user visits can open `ws://localhost:3000`.
- **Exposure on the network:** Docker publishes the port beyond localhost.

## Read first

`AGENTS.md`, the skills `clean-architecture-nestjs`, `code-organization`, `tests-best-practices` and `code-comments`, plus `packages/server/src/main.ts`, `app.module.ts`, `app.controller.ts`, `test/app.e2e-spec.ts`, `modules/discord/discord.module.ts`, `modules/discord/services/discord-client.service.ts` (lifecycle pattern) and `modules/orchestrator/utils/data-directory.util.ts`.

## Design

```text
modules/web/
├── ports/client-transport.port.ts        # IClientTransportPort + IClientConnection + Symbol
├── adapters/ws-client-transport.adapter.ts
├── services/web-access-token.service.ts
├── services/web-connection-registry.service.ts
├── handlers/web-connection.handler.ts     # auth gate; routes commands (plan 05 adds the routes)
└── web.module.ts
```

**Port**, written for both WebSocket and the future WebRTC DataChannel:

```ts
export interface IClientConnection {
  readonly id: string;
  send(event: ServerEvent): void;
  onMessage(listener: (data: unknown) => void): () => void;
  onClose(listener: () => void): () => void;
  close(code?: number, reason?: string): void;
}

export interface IClientTransportPort {
  onConnection(listener: (connection: IClientConnection) => void): () => void;
}
```

`onMessage` delivers the parsed JSON (or the raw value when it is not JSON), and the handler validates it with `parseClientCommand`. The transport knows nothing about the protocol beyond serializing `ServerEvent`.

**`WsClientTransportAdapter`:** uses the `ws` package (it is an external I/O boundary, so `vi.mock('ws')` is allowed in its spec). It attaches a `WebSocketServer({ noServer: true })` to the Nest HTTP server obtained from `HttpAdapterHost` and handles `upgrade` on the path `/ws` only.

- **Origin check during the upgrade:** accept when the `Origin` host equals the request `Host`, or when the origin is listed in `WEB_ALLOWED_ORIGINS` (comma-separated). Otherwise answer `403` and destroy the socket.
- Close the server on `onModuleDestroy`.

**`WebAccessTokenService`:** the token comes from `WEB_ACCESS_TOKEN` when set. Otherwise it is read from `<DATA_DIR>/web/access-token`, and generated on first run with `randomBytes(24).toString('base64url')` and file mode `0o600`. `verify(candidate)` uses `timingSafeEqual` and returns false on length mismatch. On application bootstrap, log `Web interface access token: <token>`.

**`WebConnectionHandler`:**
- On every new connection, wait for an `auth` command for at most 5 s.
- A correct token sends `auth.ok` and registers the connection in `WebConnectionRegistryService`.
- A wrong token, any other first command or a timeout sends `auth.failed` and closes with code `4401`.
- Commands from unauthenticated connections are never routed.
- Invalid commands from authenticated connections get an `error` event.
- In this plan, `conversation.list` answers an empty list so the round trip can be tested; plan 05 replaces it.

**`WebConnectionRegistryService`:** tracks authenticated connections, removes them on close, and offers `broadcast(event)`.

**Health route:** change `AppController` to answer `GET /health` with `{ status: 'ok' }`. Update `test/app.e2e-spec.ts`.

**`WEB_ENABLED`:** default `true`; `false` leaves the `web` module out of `AppModule`.

**`.env.example`:** add `WEB_ENABLED`, `WEB_ACCESS_TOKEN` and `WEB_ALLOWED_ORIGINS` with one-line comments. `WEB_ALLOWED_ORIGINS` is for a web app that connects to the server from another origin, for example `http://localhost:5173` (Vite dev server) or `http://localhost:4173` (`vite preview`) without the `/ws` proxy.

## Tests

- **Adapter:** upgrade on `/ws` accepted for same-origin and allowed origins; other paths destroyed without upgrading; foreign origins rejected with 403; messages forwarded; close propagated.
- **Token service:** env var precedence; generation and reuse of the file (use a temporary directory, not a mock of internal code); `verify` true, false, and false on length mismatch.
- **Handler:** use a fake `IClientTransportPort` and fake connections (`implements IClientConnection`) plus fake timers. Cover auth ok, wrong token, timeout, a command before auth, an invalid command after auth, and the `conversation.list` round trip.
- **e2e:** boot `AppModule` with `NestFactory.create` and `WEB_ACCESS_TOKEN=test`, check `GET /health`, connect with a real `ws` client to `/ws` with a same-origin header, authenticate, list, and check that a wrong token gets closed with `4401`.

## Skills

Create `.agents/skills/web-channel/SKILL.md` following `skill-authoring`. It covers the transport port, the auth gate, origin rules, the token and the health route. Plan 05 extends it.

## Acceptance

`yarn ts`, `yarn lint`, `yarn test` and `yarn test:e2e` pass. Starting the server logs the access token, and a WebSocket from a foreign origin is refused.

## Out of scope

Conversations and the orchestrator (plan 05). The React app (plan 06).

## Commit

`feat(web): add authenticated websocket transport`
