# 05 — Server: web conversations

**Model:** Sonnet 5.5 · **Effort:** high · **Depends on:** 04

## Goal

Connect the `web` module to the orchestrator: create, list and reopen conversations, send messages, stream progress, answer agent questions, configure agents and cancel turns. After this plan, a WebSocket client can do everything the Discord bot does with text. The web channel keeps no dialog state: plan 05b removes menus and option numbers from the orchestrator, and this plan is written for that end state (structured commands, stateless configuration).

## Read first

`AGENTS.md`, the skills `orchestrator`, `web-channel`, `clean-architecture-nestjs` and `tests-best-practices`, and `packages/server/src/modules/discord/handlers/discord-message.handler.ts` from `handleMessage` to `sendTurnResult`, the reference flow for streaming a turn. Also read `orchestrator/ports/{agent-turn,agent-configuration,user-question}.port.ts`, `orchestrator/models/turn-request.model.ts` and `orchestrator/testing/*`.

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
├── use-cases/list-agent-options.use-case.ts
├── use-cases/get-conversation-profiles.use-case.ts
├── use-cases/set-conversation-profiles.use-case.ts
├── use-cases/answer-conversation-question.use-case.ts
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

**`SendConversationMessageUseCase`:**
1. Reject unknown conversations with an `error` event (done by the handler before any use case).
2. Call `orchestrator.ensureSettings`. When it returns `missing` and agents are available, publish a warning `notice` ("Choose an agent, model and effort for this conversation before sending messages.") and stop: nothing is recorded or run. Without any installed agent the turn runs with the default agent.
3. Publish a `user_message` entry. On the first message, rename the conversation to the first line of the text, cut at 60 characters, and broadcast `conversation.updated`.
4. Publish state `running` and call `orchestrator.executeTurn` with `userId: 'web-local'`, `agentRole: 'CEO'` and `workspacePath` from `IWorkspacePort`.
   - Map the callbacks: `onActivity` → `thought` or `tool` entries (upsert by id; a removed thought publishes `removed: true`), `onDelegation` → `delegation`, `onInterimMessage` → `interim`, `onQuestion` → `question`, `onQueued` → state `queued`.
   - Publish `agent_response` from the `TurnResult`, then state `idle`, in a `finally` so a thrown error also returns to `idle` after publishing an error `notice`. A `steered` result leaves the state to the turn that absorbed the prompt.
5. Fire-and-forget from the handler: the command returns immediately while the turn streams.

**Other use cases:** `cancel-conversation-turn` → `orchestrator.cancelTurn`. `list-agent-options`, `get-conversation-profiles` and `set-conversation-profiles` back the configuration commands (see "Structured answers and configuration"). `answer-conversation-question` → `orchestrator.answerQuestion`.

**Routing** in `WebConnectionHandler`:
- `conversation.list` answers only the requester.
- `conversation.create` answers `conversation.created` to the requester and broadcasts `conversation.updated` to the others.
- `conversation.history` answers the requester with entries and the current state.
- The remaining commands call their use cases.

**Structured answers and configuration:** the wire protocol never carries typed numbers and the web keeps no menu state.

- `question.answer { answer }` (`{ kind: 'option', optionIndex }` or `{ kind: 'text', text }`) goes to `orchestrator.answerQuestion`. Without an open question the handler answers `error` ("There is no open question"). A text answer is echoed as a `user_message`; the confirmation, the next question or a retry follow as entries.
- `agents.list`, `models.list { agentId }` and `efforts.list { agentId, modelId }` answer the requester from the orchestrator lists. An agent that is not available answers `error` instead of being probed.
- `profiles.get { conversationId }` answers a `profiles` event: `configured` (the conversation has settings, or inherited the most recent ones through `ensureSettings`) and one entry per role. `profiles.set { conversationId, roles?, agentId, modelId?, effortId? }` validates the ids against the lists, takes the names from them, saves through the orchestrator and broadcasts `profiles`. Invalid ids answer `error`.

## Tests

- Unit specs per use case with the orchestrator fakes in `orchestrator/testing/`. The stubs implement the orchestrator ports (`IAgentTurnPort`, `IAgentConfigurationPort`, `IUserQuestionPort`), never a class.
- Fakes for `IConversationStorePort` and `IClientConnection`.
- Cover the callback mapping, the not-configured refusal, error-to-idle, the first-message title, the structured answers (echo rule, guard), the profile validation and debounce with fake timers.
- **Adapter spec:** a temporary `DATA_DIR`.
- **e2e:** extend the plan 04 test with create → history → `agents.list` → `profiles.get`, and a `question.answer` refused without an open question. No real agent is needed for this path.

## Skills

Extend `web-channel` with the conversation lifecycle, the entry mapping, the configuration commands and the store.

## Acceptance

`yarn ts`, `yarn lint`, `yarn test` and `yarn test:e2e` pass. A manual run with a real agent works through a raw WebSocket client (for example `npx wscat`): auth, create, `profiles.get` (`configured: false`), `message.send` refused with the notice, `agents.list` → `models.list` → `efforts.list` → `profiles.set`, then `message.send` "hello" and a second message that makes the agent use a tool, and see thoughts, tools and the `agent_response`.

## Commit

`feat(web): run conversations over the web channel`
