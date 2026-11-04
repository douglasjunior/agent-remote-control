---
name: web-channel
description: >
  Web interface channel: the IClientTransportPort WebSocket transport, access token and origin
  check, authenticated connections, web conversations (store, history, entry mapping, turn state),
  stateless agent configuration, structured question answers, /health and the WEB_* variables.
  Use when working with the web module, WebSocket connections, the access token or web conversations.
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

## Conversations

- Ids are `web-<randomUUID()>` so they never collide with Discord ids in the shared session store. The web
  channel owns its history through `IConversationStorePort`; Discord keeps its own.
- `WebConnectionHandler` routes authenticated commands. `conversation.list` and `conversation.history`
  answer the requester only; `conversation.create` answers the requester with `conversation.created` and
  broadcasts `conversation.updated` to the other connections. Every command carrying a `conversationId`
  for an unknown conversation answers an `error` event before reaching a use case.
- `SendConversationMessageUseCase` never rejects: it checks the configuration, records the
  `user_message` (the first one renames the conversation to its first line, cut at 60 characters) and runs
  `orchestrator.executeTurn` as `userId: 'web-local'` with role `CEO` in the workspace base directory.
  `message.send` returns immediately while the turn streams.
- Turn callbacks become entries: `onActivity` → `thought` or `tool`, `onDelegation` → `delegation`,
  `onInterimMessage` → `interim`, `onQuestion` → `question`; the `TurnResult` becomes `agent_response`.
  Steering and cancellation markers have no entry.
- Entry ids are stable (`thought:<id>`, `tool:<toolCallId>`, `delegation:<round>:<role>:<phase>`) so the
  store and the client upsert by id; other entries get a random id.
- Conversation state is `running` from the start of the turn, `queued` after `onQueued` until output
  arrives, and `idle` when the turn ends or throws. A `steered` result leaves the state to the turn that
  absorbed the prompt. Errors become `notice` entries with level `error`.
- The web channel has no dialog state. Agent configuration is a stateless API over the orchestrator's lists:
  `agents.list`, `models.list { agentId }` and `efforts.list { agentId, modelId }` answer the requester with
  `agents.list`, `models.list` and `efforts.list` events (an unavailable agent answers `error`, so no CLI is
  probed for an unknown id); `profiles.get { conversationId }` answers a `profiles` event with `configured` and one
  entry per role; `profiles.set { conversationId, roles?, agentId, modelId?, effortId? }` goes to `IAgentConfigurationPort.configureProfiles`, which validates the ids against those lists and takes the names
  from them (the web layer holds no rule), then broadcasts `profiles`.
  `GetConversationProfilesUseCase` reads `hasSettings`, a pure query, so reading never changes a conversation.
- `message.send` runs a turn only when the conversation is configured, meaning `ensureSettings` (which copies the most recent settings into a new conversation) is not `missing`
  or no agent is installed (the default agent runs). Otherwise the server publishes a warning `notice` and
  neither records the message nor runs a turn.
- Questions are answered with `question.answer` (`answer` is `{ kind: 'option', optionIndex }` or
  `{ kind: 'text', text }`), passed to `IUserQuestionPort.answerQuestion` unchanged. Without an open question the command answers an
  `error` event. A text answer is echoed as a `user_message`; an option answer is not. The confirmation, the next
  question or a retry follow as entries.
- `WebConversationEventsService` upserts an entry and broadcasts `conversation.entry` (broadcast first, so
  persistence never reorders the stream), and keeps the state in memory.
- `JsonConversationStoreAdapter` writes `<DATA_DIR>/web/conversations.json` and
  `<DATA_DIR>/web/history/<id>.json` atomically (temporary file, then rename), debounced by 1 s per file,
  and flushes at the end of every turn and on module destroy. An id reaches a file path only after it is
  found among the known conversations. Files that do not match the protocol schemas are ignored.

## Health

`GET /health` belongs to `AppController`. The server does not serve the web interface: it is a separate
app (Vite dev server or preview locally, nginx in production) that reaches the server through the
WebSocket, so its origin must be listed in `WEB_ALLOWED_ORIGINS`.

## Environment

`WEB_ENABLED` (default `true`; `false` leaves `WebModule` out of `AppModule`), `WEB_ACCESS_TOKEN`
and `WEB_ALLOWED_ORIGINS`.
