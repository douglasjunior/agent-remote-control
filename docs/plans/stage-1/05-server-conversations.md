# 05 — Server: web conversations

**Model:** Sonnet 5.5 · **Effort:** high · **Depends on:** 04

## Goal

Connect the `web` module to the orchestrator: create, list and reopen conversations, send messages, stream progress, answer questions and agent/model menus, and cancel turns. After this plan, a WebSocket client can do everything the Discord bot does with text.

## Read first

`AGENTS.md`, the skills `orchestrator`, `web-channel`, `clean-architecture-nestjs` and `tests-best-practices`, and — most important — `packages/server/src/modules/discord/handlers/discord-message.handler.ts` from `handleMessage` to `sendTurnResult`. It is the reference flow to mirror. Also read `orchestrator/services/orchestrator.service.ts`, `orchestrator/models/agent-config-outcome.model.ts`, `orchestrator/models/turn-request.model.ts` and `orchestrator/testing/*`.

## Design

```text
modules/web/
├── ports/conversation-store.port.ts
├── adapters/json-conversation-store.adapter.ts
├── services/web-conversation-events.service.ts
├── use-cases/create-conversation.use-case.ts
├── use-cases/list-conversations.use-case.ts
├── use-cases/get-conversation-history.use-case.ts
├── use-cases/send-conversation-message.use-case.ts
├── use-cases/cancel-conversation-turn.use-case.ts
├── use-cases/open-conversation-config.use-case.ts
└── utils/conversation-entry.util.ts  # maps orchestrator models to protocol entries
```

**Conversation ids:** `web-<randomUUID()>`, so they never collide with Discord ids in the shared session store.

**`IConversationStorePort`** (the web channel owns its history; Discord keeps its own):

```ts
list(): Promise<readonly ConversationSummary[]>;                  // most recently updated first
create(): Promise<ConversationSummary>;                           // title "New conversation"
rename(id: string, title: string): Promise<ConversationSummary>;
touch(id: string): Promise<void>;                                 // updatedAt
exists(id: string): Promise<boolean>;
history(id: string): Promise<readonly ConversationEntry[]>;
upsertEntry(id: string, entry: ConversationEntry): Promise<void>; // replaces by entry.id, keeps first position
```

**`JsonConversationStoreAdapter`:**
- Writes `<DATA_DIR>/web/conversations.json` and `<DATA_DIR>/web/history/<id>.json`.
- Keeps each loaded history in memory and writes it with a **1 s debounce**, because thoughts stream many updates per second. It flushes immediately on `onModuleDestroy` and when a turn ends.
- Writes atomically: write to a temp file, then rename.
- JSON files match the existing stores (`json-session-store`, `json-agent-settings-store`) and need nothing beyond the file system. When history outgrows them (search, pagination, many long conversations), SQLite (`node:sqlite`, built into Node 24) replaces this adapter behind the same port, still without a separate database service.

**`WebConversationEventsService`:**
- `publishEntry(conversationId, entry)` upserts into the store and broadcasts `conversation.entry`.
- `publishState(conversationId, state)` keeps the state in memory and broadcasts `conversation.state`.
- `stateOf(conversationId)` returns the current state for history responses.

**`SendConversationMessageUseCase`**, mirroring the Discord handler:
1. Reject unknown conversations with an `error` event.
2. Publish a `user_message` entry. On the first message, rename the conversation to the first line of the text, cut at 60 characters, and broadcast `conversation.updated`.
3. Call `orchestrator.resolveInput({ conversationId, prompt })` and map each non-`execute` resolution to entries:

   | Resolution | Entries |
   |---|---|
   | `selection`, `invalid`, `profiles_menu` | `selection` |
   | `profiles_updated` | `notice`, then `selection` |
   | `question`, `invalid_answer` | `question` (plus a warning `notice` for `invalid_answer`) |
   | `answered` | `notice`, then `question` for `next` |
   | `configured`, `language_set`, `invalid_language`, `profiles_closed` | `notice` |

   Notice texts are short English sentences composed in the web module. Do not import the Discord formatter: modules do not depend on another channel.
4. For `execute`:
   - Publish state `running` and call `orchestrator.executeTurn` with `userId: 'web-local'`, `agentRole: 'CEO'` and `workspacePath` from `IWorkspacePort`.
   - Map the callbacks: `onActivity` → `thought` or `tool` entries (upsert by id; a removed thought publishes `removed: true`), `onDelegation` → `delegation`, `onInterimMessage` → `interim`, `onQuestion` → `question`, `onQueued` → state `queued`.
   - Publish `agent_response` from the `TurnResult`, then state `idle`, in a `finally` so a thrown error also returns to `idle` after publishing an error `notice`.
5. Fire-and-forget from the handler: the command returns immediately while the turn streams.

**Other use cases:** `cancel-conversation-turn` → `orchestrator.cancelTurn`. `open-conversation-config` → `startAgentSelection`, `startConfigSelection` or `startProfilesSelection` by `menu`; `unavailable` becomes a warning `notice`. `config.cancel` → `cancelConfigSelection`.

**Routing** in `WebConnectionHandler`:
- `conversation.list` answers only the requester.
- `conversation.create` answers `conversation.created` to the requester and broadcasts `conversation.updated` to the others.
- `conversation.history` answers the requester with entries and the current state.
- The remaining commands call their use cases.

**Answers by button:** questions and menus are answered with plain `message.send` carrying the option number as text. The orchestrator already parses numbers (`UserQuestionQueueService` uses 1-based options; `SubmitAgentConfigSelectionUseCase` matches `option.index`).

## Tests

- Unit specs per use case with the orchestrator fakes in `orchestrator/testing/`. Add a small stub for `OrchestratorService` in `web/testing/` if the existing ones do not cover it, implementing the methods used.
- Fakes for `IConversationStorePort` and `IClientConnection`.
- Cover every resolution kind of the mapping table, the callback mapping, error-to-idle, the first-message title and debounce with fake timers.
- **Adapter spec:** a temporary `DATA_DIR`.
- **e2e:** extend the plan 04 test with create → history → `config.open` → a `selection` entry arrives. No real agent is needed for this path.

## Skills

Extend `web-channel` with the conversation lifecycle, the entry mapping table and the store. Update `orchestrator` only if its public surface changed.

## Acceptance

`yarn ts`, `yarn lint`, `yarn test` and `yarn test:e2e` pass. A manual run with a real agent works through a raw WebSocket client (for example `npx wscat`): auth, create, send "hello", and see thoughts, tools and the `agent_response`.

## Commit

`feat(web): run conversations over the web channel`
