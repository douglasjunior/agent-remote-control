---
name: web-channel
description: >
  Web interface channel: the IClientTransportPort WebSocket transport, access token and origin
  check, authenticated connections, web conversations (store, history, entry mapping, turn state),
  stateless agent configuration, structured question answers, the artifacts.* commands of each conversation board, the skills.* commands, the combined local and remote transports, agent CLI login
  (auth.* commands and events), uploads, file search, /health and the WEB_* variables. Use when working with the web module, WebSocket connections, the
  access token or web conversations.
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
  `close`) hide the technology. `WebModule` binds the port to `CombinedClientTransportAdapter`, which hands the
  connections of `WsClientTransportAdapter` (local) and of the remote module's WebRTC data channels alike, so every
  rule below applies to both.
- `onMessage` delivers parsed JSON, or the raw value when the payload is not JSON (`parseJsonMessage`). The transport
  only serializes `ServerEvent`; validating commands belongs to the handler through `parseClientCommand`.
- `WsClientTransportAdapter` uses `ws` with `WebSocketServer({ noServer: true })` attached to the
  `upgrade` event of the Nest HTTP server. It accepts the path `/ws` only and destroys the socket of any
  other upgrade. It enforces a 256 KiB payload limit and closes the server on module destroy.
- A data channel carries no close code: a connection refused by the auth gate reads `auth.failed`, sent before the close.

## Origin check

- The upgrade is accepted when the `Origin` host equals the request `Host`, or when the origin is listed
  in `WEB_ALLOWED_ORIGINS` (comma-separated, compared without a trailing slash).
- A missing or malformed `Origin` is rejected. Rejection answers `403` and destroys the socket.
- When the web app reaches the server directly (no proxy), its origin goes in `WEB_ALLOWED_ORIGINS`.

## Access token and auth gate

- `AccessTokenService` (module `access-token`, imported by the web and remote modules) takes the token from
  `WEB_ACCESS_TOKEN`, otherwise from `<DATA_DIR>/web/access-token`, generated once with
  `randomBytes(24).toString('base64url')` and file mode `0o600`. `token()` returns it; `verify` compares with
  `timingSafeEqual` and returns false on a length mismatch.
- On bootstrap it logs `Web interface access token: <token>` from a context the log files leave out.
- `WebConnectionHandler` waits at most 5 s for an `auth` command on each connection. A wrong token, any
  other first command or a timeout sends `auth.failed` and closes with code `4401`. Commands from a
  connection that has not authenticated are never routed.
- A correct token sends `auth.ok` and registers the connection in `WebConnectionRegistryService`, which
  removes it on close and offers `broadcast(event)`.
- Invalid commands from an authenticated connection answer an `error` event.
- `ping` from an authenticated connection answers `pong`; the web app drops a connection that stops answering.

## Conversations

- Ids are `web-<randomUUID()>` so they never collide with Discord ids in the shared session store. The web
  channel owns its history through `IConversationStorePort`; Discord keeps its own.
- `WebConnectionHandler` routes authenticated commands. `conversation.list`, `conversation.history` and
  `conversation.entries` answer the requester only; `conversation.create` answers the requester with `conversation.created` and
  broadcasts `conversation.updated` to the other connections.
- `conversation.rename { conversationId, title }` (`RenameConversationUseCase`, title trimmed, up to
  `MAX_CONVERSATION_TITLE_LENGTH`) and `conversation.archive { conversationId, archived }`
  (`ArchiveConversationUseCase`, stamping or clearing `archivedAt`) publish `conversation.updated` to every
  connection, the requester included; neither is activity, so `updatedAt` and the place in the list stay. An
  archived conversation still opens and takes messages.
- Every command carrying a `conversationId` for an unknown conversation answers an `error` event before reaching a use case.
- `message.send` returns immediately while the turn streams: `SendConversationMessageUseCase` never rejects,
  records the `user_message` and runs the turn as the CEO only when the conversation is configured.
- Turn callbacks become entries with stable ids (`thought:<turnId>:<role>:<id>`, `tool:<turnId>:<role>:<toolCallId>`,
  `delegation:<delegationId>:<phase>`) so the store and the client upsert by id. `ConversationEntryService` builds
  every entry and owns the clock and the random ids.
- The conversation state (`running`, `queued`, `idle`) belongs to the conversation, not to a turn, and is
  published only when it changes. `WebConversationEventsService` places each entry in the history, then broadcasts it
  with its position, and keeps the CEO's response being written as an in-memory draft (`conversation.draft`), never
  stored.
- `JsonConversationStoreAdapter` writes `<DATA_DIR>/web/conversations.json` and
  `<DATA_DIR>/web/history/<id>.json` atomically (temporary file, then rename), debounced by 1 s per file,
  and flushes at the end of every turn and on module destroy. An id reaches a file path only after it is
  found among the known conversations. Files that do not match the protocol schemas are ignored.

- The history is read in pages. Every entry keeps its position in the history for good (`upsertEntry` replaces in
  place or appends, and returns the position). `conversation.history` (`GetConversationHistoryUseCase`) answers the
  latest page with `start`, the position of its first entry; `conversation.entries { conversationId, before }`
  (`ListEarlierConversationEntriesUseCase`) answers the page right before `before`, with its own `start`.
- `history-page.util.ts` cuts the pages. A segment starts at the beginning of the history and at each user message no
  delegation spans: a delegation spans from its `started` entry to the entry that ends it, or, while it still runs
  (`WebConversationEventsService.liveDelegationsOf`, cleared when the conversation goes `idle`), to the end of the
  history; one a restart stopped spans nothing. A page holds whole segments, as many as fit `HISTORY_PAGE_SIZE`
  (200) entries and at least one, so it always carries whole delegations with their steps and the latest page every
  delegation the squad still shows. The latest page also reaches back to the oldest question still open.

Read [references/turns-and-entries.md](references/turns-and-entries.md) before changing `message.send`,
`turn.cancel`, message attachments, the callback-to-entry mapping, entry ids, the conversation state or the draft.

## Command areas

Each area has a reference with the exact commands, events, limits and edge cases. Read it before changing that area.

- **Retries of a failed turn**: `retry` entries (one card per failure, `closed: true` once its wait ends), the `retry.now` and `retry.stop` commands, and a `message.send` while a retry waits, which retries now with the message instead of starting a turn. Read [references/retries.md](references/retries.md).
- **Questions**: `question.answer` with an option or a text (with attachments), the server closing questions
  (`closed: true`), and restoring questions and interrupted work after a restart (`work.resume`,
  `conversation.interrupted`). Read [references/questions.md](references/questions.md).
- **Board**: the `artifacts.*`/`artifact.*` commands over `IArtifactsPort` acting as the web user, the
  `artifact.result` answers, the `artifact.updated`/`artifact.deleted` broadcasts and `projects.list`. Read
  [references/board.md](references/board.md).
- **Skills**: `skills.list`, `skill.get` and `skill.delete` over `IAgentSkillsPort`; the web never writes a skill.
  Read [references/skills.md](references/skills.md).
- **Agents**: the stateless configuration API (`agents.list`, `models.list`, `efforts.list`, `profiles.get`,
  `profiles.set`), the cached `quota.get` and `auth.status` queries that answer `quota.failed`/`auth.status.failed`
  (never `error`), and the CLI login (`auth.login`, `auth.input`, `auth.cancel`) broadcast to every connection.
  Read [references/agents.md](references/agents.md).
- **Composer**: `prompts.history`, the per-connection `files.search` session for `@` mentions and the framed
  `upload.*` protocol into `.arc-uploads/<conversationId>/`. Read [references/composer-commands.md](references/composer-commands.md).

## Health

`GET /health` belongs to `AppController`.

## Serving the web app

`WebStaticModule` (imported by `WebModule`) configures `ServeStaticModule` from `WEB_STATIC_DIR`: when it
is set, the server serves that directory (the build of `packages/web`) on `PORT` and answers every other
`GET` with its `index.html`, so the client-side routes of React Router resolve. The page and `/ws` then share
one origin. When it is empty nothing is served. `SERVER_ROUTES` in `web-static.module.ts` lists the paths the
server answers itself (`/health`, `/ws`); a new HTTP route of the server is added there, or the fallback
shadows it. The Docker image sets `WEB_STATIC_DIR`.

Without it, the web app is a separate app (Rsbuild dev server or preview locally, any static host otherwise)
that reaches the server through the WebSocket, so its origin must be listed in `WEB_ALLOWED_ORIGINS` unless
a proxy in front of both makes the upgrade same-origin.

## Environment

`WEB_ENABLED` (default `true`; `false` leaves `WebModule` out of `AppModule`, remote access included), `WEB_ACCESS_TOKEN`,
`WEB_ALLOWED_ORIGINS`, `WEB_STATIC_DIR`, and `REMOTE_ENABLED` and `REMOTE_URL` of the remote module that `WebModule` imports. The agent login commands follow `AGENT_AUTH_ENABLED`, `AGENT_AUTH_LOGIN_TIMEOUT_MS` and
`AGENT_AUTH_STATUS_TIMEOUT_MS`.
