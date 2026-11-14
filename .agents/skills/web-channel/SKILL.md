---
name: web-channel
description: >
  Web interface channel: the IClientTransportPort WebSocket transport, access token and origin
  check, authenticated connections, web conversations (store, history, entry mapping, turn state),
  stateless agent configuration, structured question answers, the artifacts.* commands of each conversation board, the skills.* commands, agent CLI login
  (auth.* commands and events), /health and the WEB_* variables. Use when working with the web module, WebSocket connections, the
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
- When the web app reaches the server directly (no proxy), its origin goes in `WEB_ALLOWED_ORIGINS`.

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
  broadcasts `conversation.updated` to the other connections. `conversation.rename { conversationId, title }`
  (`RenameConversationUseCase`, title trimmed, up to `MAX_CONVERSATION_TITLE_LENGTH`) and
  `conversation.archive { conversationId, archived }` (`ArchiveConversationUseCase`, stamping or clearing
  `archivedAt`) publish `conversation.updated` to every connection, the requester included; neither is activity, so
  `updatedAt` and the place in the list stay. An archived conversation still opens and takes messages. Every command
  carrying a `conversationId` for an unknown conversation answers an `error` event before reaching a use case.
- `SendConversationMessageUseCase` never rejects: it checks the configuration, records the
  `user_message` (the first one renames the conversation to its first line, cut at 60 characters) and runs
  `orchestrator.executeTurn` as `userId: 'web-local'` with role `CEO` in the workspace base directory.
  `message.send` returns immediately while the turn streams. Each accepted prompt is also appended to the
  prompt history through `IPromptHistoryPort`.
- `prompts.history` (with a `requestId`) answers the requester with `prompts.list`: the stored prompts, most
  recent first. The history is global to the machine, capped at `MAX_PROMPT_HISTORY`, never repeats the
  latest prompt, and is recorded by the server only; the client never appends.
- **Board of a conversation** (`WebArtifactsService` over `IArtifactsPort`, acting as `{ kind: 'user', channel: 'web' }`):
  `artifacts.list { conversationId }` answers `artifacts.list` with every artifact summary, closed ones included (no sections
  or history); `artifact.get { conversationId, id }` answers `artifact.detail` (sections and history) or an `error` for an unknown id;
  `artifact.create`, `artifact.update`, `artifact.comment` and `artifact.delete` (each with a `requestId`) answer the requester with
  `artifact.result { conversationId, requestId, ok, id | error }`. `artifact.create` maps the switches `businessRefinement` and
  `technicalRefinement` to `pending` or `skipped`; `artifact.update` replaces the sections it carries. `onModuleInit` subscribes to
  `IArtifactsPort.onChange` and broadcasts `artifact.updated { conversationId, artifact }` (a summary; a client showing the detail asks
  for it again) and `artifact.deleted` to every connection, whoever made the change, for web conversations only (`IConversationStorePort.exists`).
  `projects.list` answers the project folders of the workspace (`IWorkspacePort.listProjectFolders`), the values an artifact's project takes.
- **Skills** (`WebSkillsService` over `IAgentSkillsPort`, from `AgentDefinitionsModule`): `skills.list` answers every skill with its roles
  and whether it is built-in (`listAll`); `skill.get { name }` answers `skill.detail { name, skill }`, the skill with its content built for
  the first role that reads it (`readAny`), or `skill: null` for an unknown name. The web only reads skills: the user changes a custom one
  by asking the CEO, which writes it with `<skill_write>`.
  The artifact mutations are logged by type. A `delegation` entry carries `artifactId` when the agent held one.
- Turn callbacks become entries: `onActivity` → `thought` or `tool` (always carrying the `role` of the agent that produced it, the CEO included), `onDelegation` → `delegation` (with the CEO's `summary` and, as `prompt`, the `taskSpec` it wrote for the agent, which reads as empty in an entry stored without it because a history file is validated whole; `phase` is `started`, `finished`, `failed` or `cancelled`),
  `onInterimMessage` → `interim`, `onQuestion` → `question` (with `askerRole` besides `askerRoleName`, `closed: false`, and `recommendedIndex` and `timeout` (`expiresAt` in epoch milliseconds plus `durationMs`) while they apply), and, when a question times out, the open question is closed and a `warning` `notice` tells what was assumed (`No reply in <n> min, <role>: assumed the recommended answer: <option>.` or `no answer assumed`) before the next `question`; the `TurnResult` becomes `agent_response`.
  Steering and cancellation markers have no entry.
- `ConversationEntryService` (`web/services/conversation-entry.service.ts`) builds every entry. It owns the clock and the random ids, so the use cases and services that publish entries receive it through their constructors.
- Entry ids are stable so the store and the client upsert by id, and each carries what makes it unique across the conversation; other entries get a random id:
  - `thought:<turnId>:<role>:<id>` and `tool:<turnId>:<role>:<toolCallId>`: the `turnId` is generated for each `SendConversationMessageUseCase` turn execution, because every agent numbers its own thoughts (`synthetic:<n>` restarts with each stream) and a shared id would overwrite another turn's or agent's entry. A step streamed again within its turn updates in place.
  - `delegation:<delegationId>:<phase>`: the orchestrator generates a `delegationId` (UUID) for each delegation and the `delegation` entry carries it as a required field. The `round` restarts at 1 in each turn, so an id built from it would overwrite the delegation of an earlier turn.
- Conversation state belongs to the conversation, not to a turn. `WebConversationTurnsService` tracks the active turns of each conversation (`begin`, `markRunning`, `markQueued`, `end`) and derives the published state: `running` when any active turn is running, `queued` only when every active turn is queued, `idle` only when none is active. A state is published only when it changes, so overlapping turns never repeat `running` or `idle`. A turn removes itself when it ends, however it ends: a result (a `steered` one included, which leaves `running` to the turn that absorbed the prompt) or a thrown error, which also becomes a `notice` entry with level `error`. When the conversation becomes `idle` the service closes the questions still open, publishes `idle` and flushes the store. `conversation.history` reports the state published by the same events service, so it always matches the stream.
- The web channel has no dialog state. Agent configuration is a stateless API over the orchestrator's lists:
  `agents.list`, `models.list { agentId }` and `efforts.list { agentId, modelId }` answer the requester with
  `agents.list`, `models.list` and `efforts.list` events (an unavailable agent answers `error`, so no CLI is
  probed for an unknown id); `profiles.get { conversationId }` answers a `profiles` event with `configured` and one
  entry per role; `profiles.set { conversationId, roles?, agentId, modelId?, effortId? }` goes to `IAgentConfigurationPort.configureProfiles`, which validates the ids against those lists and takes the names
  from them (the web layer holds no rule), then broadcasts `profiles`.
  `GetConversationProfilesUseCase` reads `hasSettings`, a pure query, so reading never changes a conversation.
- `message.send` may carry `attachments` (`{ path, name }`, at most `MAX_ATTACHMENTS`) and then `text` may be empty.
  Every path must be a file of `.arc-uploads/<conversationId>/` that exists (`isUploadPathOf` rejects any other
  or climbing path); otherwise an `error` notice is recorded and no turn runs. The `user_message` entry keeps the
  attachments. The use case resolves the files through `WebConversationUploadsService`, which reads each file's size and derives its
  `contentType` from the extension, and hands the files to `executeTurn` as `TurnRequest.attachments` (absolute path under the
  workspace base directory) next to the text exactly as typed: like every channel, it does not rewrite the prompt
  for them, and the orchestrator transcribes audio and lists the other files for the agent. What it transcribed, and
  what it could not, arrives through `onTranscription` and is recorded as `notice` entries (`🎙️ <name>: <text>` at
  `info`, the warnings at `warning`). An attachment-only message titles a new conversation after the first file
  name and is not added to the prompt history.
- `message.send` runs a turn only when the conversation is configured, meaning `ensureSettings` (which copies the most recent settings into a new conversation) is not `missing`
  or no agent is installed (the default agent runs). Otherwise the server publishes a warning `notice` and
  neither records the message nor runs a turn.
- `quota.get { refresh? }` answers the requester with `quota.report { reports, fetchedAt }`, the `IAgentTurnPort.getQuota()` reports (`AgentQuotaReport`: `agent`, `status` `ok`, `unsupported` or `failed`, and `quota`). Every query starts the agents' CLIs, so `WebAgentQuotaService` reuses a result for `QUOTA_CACHE_TTL_MS` (4 minutes), and all connections share the query in progress; `refresh: true` skips the stored result, and a failure is never stored. A query that throws answers `quota.failed`, not `error`, because the settings sheet takes an `error` without a `conversationId` as its own and this query runs in the background. `remainingFraction` has no range in the schema, since an invalid frame is dropped whole; clients clamp it.
- `auth.status { refresh? }` answers the requester with `auth.status { agents, fetchedAt }`, the `IAgentAuthPort.listAuthInfo()` entries (`AgentAuthInfo`: `agentId`, `displayName`, `status` `authenticated`, `unauthenticated` or `unknown`, and `detail`). Every query starts CLIs, so `WebAgentAuthService` reuses a result for `AUTH_STATUS_CACHE_TTL_MS` (2 minutes), below the client's 5-minute check, and all connections share the query in progress; `refresh: true` skips the stored result and a failure is never stored. A query that throws answers `auth.status.failed`, not `error`, for the same reason as `quota.failed`.
- `auth.login { agentId }` starts the CLI login (`IAgentAuthPort.startLogin`); every `auth.login { agentId, event }` progress event (`url` with an optional device `code`, `prompt`, `completed`, `failed`, `cancelled`) goes to **every** open connection, so any tab shows the same link and result, and a `completed` login also broadcasts a fresh `auth.status`. A login that cannot start (disabled feature, no CLI login, CLI missing) answers the requester alone with a `failed` event. `auth.input { agentId, text }` writes a code pasted from the browser to the waiting login and answers a `failed` event when none waits; `auth.cancel { agentId }` stops the login. `auth.login` and `auth.cancel` are logged by type; the link, the code and `auth.input` never reach the log.
- Questions are answered with `question.answer` (`answer` is `{ kind: 'option', optionIndex }` or
  `{ kind: 'text', text, attachments? }`, where text may be empty with attachments), passed to `IUserQuestionPort.answerQuestion` with the attachments resolved by `WebConversationUploadsService`, the same check `message.send` uses; a file that is not an upload of the conversation records an `error` notice and answers nothing. Without an open question the command closes the questions still shown as open and answers an
  `error` event. A valid answer is echoed as a `user_message` (the text typed, or the text of the chosen option, with its attachments). The confirmation, the next
  question or a retry follow as entries.
- `QuestionCard` shows a `role="timer"` countdown (`m:ss`, a shadcn `Progress` bar that drains over `timeout.durationMs`, turning destructive in the last 30 s) on the open question while it carries `timeout`, and a `Recommended` badge on the option at `recommendedIndex`. The countdown runs from the absolute `expiresAt`, so a reload or reconnect shows the true time left.
- A `question` entry stays open (`closed: false`) until the server closes it by upserting the same entry id with `closed: true`, which keeps it in place in the history. `WebConversationEventsService.closeOpenQuestions` does it, and it knows the open questions because it sees every entry it publishes. Two events close a question: any `question.answer` the orchestrator accepts (`next`, `invalid` or `answered`), before the entries that follow it are published, and the conversation reaching `idle`, because nothing can answer the question any more (cancellation included). Closing a question does not discard the draft.
- Web turns are `resumable`, so a server restart keeps their questions and work (see the orchestrator skill). `conversation.history` settles the questions first (`GetConversationHistoryUseCase`): the open entry of the question the queue restored is tracked again, a restored question with no open entry is published, and any other open entry has nothing waiting on it and is closed by `settleOrphanedQuestions`. `closeUnanswerableQuestions` closes every open one when the orchestrator refuses an answer. Both closings add one `warning` `notice`, id `question-abandoned:<questionId>`, telling the user to send a message to continue; a refused answer is not delivered. A conversation becoming `idle` keeps its questions open while the orchestrator still has one pending.
- Answering the last question of a restored request (`restoredWork` in the submission) runs `ResumeConversationWorkUseCase.deliverAnswers`. `work.resume { conversationId, workId }` runs its `execute`, for an agent a restart stopped mid-round; an agent that asked never offers it, and a request for work no longer listed does nothing. `conversation.history` carries the list in `interrupted`, and `conversation.interrupted { conversationId, interrupted }` broadcasts it when it changes. `WebConversationTurnsService.run` turns the callbacks of any turn into entries. `WebConversationEventsService` records nothing after `onModuleDestroy`, because what dying turns report during a shutdown did not happen to the conversation.
- `WebConversationEventsService` upserts an entry and broadcasts `conversation.entry` (broadcast first, so
  persistence never reorders the stream), and keeps the state in memory. It also keeps the draft of each
  conversation in memory: the user-facing text of the CEO's response being written (`TurnRequest.onDraft`),
  broadcast as `conversation.draft { conversationId, text }` (whole text at every event, only when it
  changed) and never stored in the history. The draft is discarded (`text: ''`, sent before the entry) by the
  entry that delivers the response (`interim`, `question` or an `agent_response` that is not `steered`) and
  when the conversation goes `idle`. `conversation.history` carries the current draft in `draft` when there
  is one, so a conversation opened mid-response resumes it.
- `JsonConversationStoreAdapter` writes `<DATA_DIR>/web/conversations.json` and
  `<DATA_DIR>/web/history/<id>.json` atomically (temporary file, then rename), debounced by 1 s per file,
  and flushes at the end of every turn and on module destroy. An id reaches a file path only after it is
  found among the known conversations. Files that do not match the protocol schemas are ignored.
- File search for `@` mentions is one session per connection (`WebFileSearchSessionsService`). The first
  `files.search { requestId, query }` with a new id replaces the connection's session and starts a walk of
  the workspace base directory; later ones with the same id only change the query; `files.close` (and the
  connection closing) stops the walk. Each update is a `files.results { requestId, items, walking }`:
  up to `MAX_MENTION_RESULTS` items `{ path, kind, matches }`, where `path` is relative to the base
  directory with `/` separators and a trailing `/` on directories, and `matches` are the indexes of the
  characters of `path` matched by the query. `walking` is `true` until the walk ends.
- `IWorkspaceFileSearchPort` (workspace module) opens a `FileSearchSession` (`setQuery`, `stop`) over a
  listener (`onResults`, `onWalking`). `LocalWorkspaceFileSearchAdapter` walks breadth first, one batch
  per directory, skipping dot entries and `node_modules`; a symbolic link counts when its target resolves
  and a link back to an ancestor is not entered. `FileSearchIndex` scores the entries with `fuzzysort`
  (case-insensitive subsequence match over the whole path, so `site/comp` finds `site/app/components`) in
  slices of 5 000 entries under a generation token, and without a query lists the base directory, folders
  first.
- Uploads travel as frames, not HTTP, so any `IClientTransportPort` (WebSocket, later a DataChannel) carries them.
  `upload.start { uploadId, conversationId, name, size }` opens a writer (`IWorkspaceUploadPort`) in
  `<workspace>/.arc-uploads/<conversationId>/` and answers `upload.ready`; the client then sends
  `upload.chunk { uploadId, index, dataBase64 }` one at a time (at most `UPLOAD_CHUNK_BYTES` raw bytes), each
  answered by `upload.ack { index }`; `upload.finish` answers `upload.done { attachment }` once the received
  bytes equal `size`. `WebUploadSessionsService` keeps the uploads per connection and answers `upload.failed
  { reason }`, discarding the partial file, for a size above `MAX_UPLOAD_BYTES`, an id in use, more than
  `MAX_CONCURRENT_UPLOADS` per connection, an out-of-order or oversized chunk, an incomplete file, an unknown
  id, or `UPLOAD_IDLE_TIMEOUT_MS` of silence. `upload.abort` and the connection closing discard it too.
  `LocalWorkspaceUploadAdapter` writes a hidden `.part` file and publishes it with a hard link, numbering a
  taken name (`a (1).png`); the adapter keeps only the last path segment of the name.
- `JsonPromptHistoryAdapter` keeps the history in `<DATA_DIR>/web/prompt-history.json`, written atomically
  after every append. A file that is not a list of strings is ignored.

## Health

`GET /health` belongs to `AppController`. The server does not serve the web interface: it is a separate
app (Vite dev server or preview locally, nginx in production) that reaches the server through the
WebSocket, so its origin must be listed in `WEB_ALLOWED_ORIGINS`.

## Environment

`WEB_ENABLED` (default `true`; `false` leaves `WebModule` out of `AppModule`), `WEB_ACCESS_TOKEN`
and `WEB_ALLOWED_ORIGINS`. The agent login commands follow `AGENT_AUTH_ENABLED`, `AGENT_AUTH_LOGIN_TIMEOUT_MS` and
`AGENT_AUTH_STATUS_TIMEOUT_MS`: the login timeout stops a login nobody finished, the status timeout bounds each login-state probe.
