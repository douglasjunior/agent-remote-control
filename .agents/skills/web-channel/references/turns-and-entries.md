# Turns and entries

## Sending a message

- `SendConversationMessageUseCase` never rejects: it checks the configuration, records the `user_message` (the first one renames the conversation to its first line, cut at 60 characters) and runs `orchestrator.executeTurn` as `userId: 'web-local'` with role `CEO` in the workspace base directory. `message.send` returns immediately while the turn streams.
- Each accepted prompt is also appended to the prompt history through `IPromptHistoryPort`.
- `message.send` runs a turn only when the conversation is configured, meaning `ensureSettings` is not `missing` or no agent is installed (the default agent runs). Otherwise the server publishes a warning `notice` and neither records the message nor runs a turn.
- `turn.cancel { conversationId }` cancels the running turn through `IAgentTurnPort.cancelTurn`; when none runs, an `info` `notice` says there is nothing to cancel.

## Attachments of a message

- `message.send` may carry `attachments` (`{ path, name }`, at most `MAX_ATTACHMENTS`) and then `text` may be empty.
- Every path must be a file of `.arc-uploads/<conversationId>/` that exists (`isUploadPathOf` rejects any other or climbing path); otherwise an `error` notice is recorded and no turn runs. The `user_message` entry keeps the attachments.
- The use case resolves the files through `WebConversationUploadsService`, which reads each file's size and derives its `contentType` from the extension, and hands the files to `executeTurn` as `TurnRequest.attachments` (absolute path under the workspace base directory) next to the text exactly as typed: like every channel, it does not rewrite the prompt for them.
- What the orchestrator transcribed, and what it could not, arrives through `onTranscription` and is recorded as `notice` entries (`🎙️ <name>: <text>` at `info`, the warnings at `warning`).
- An attachment-only message titles a new conversation after the first file name and is not added to the prompt history.

## Callbacks to entries

`WebConversationTurnsService.run` turns the callbacks of any turn into entries:

- `onActivity` → `thought`, `tool` or `skill` (a skill read or written: `action`, `names`, `status`, `created`, `error`); every one carries the `role` of the agent that produced it, the CEO included.
- `onDelegation` → `delegation`, with the CEO's `summary` and, as `prompt`, the `taskSpec` it wrote for the agent, which reads as empty in an entry stored without it, so the entry stays in the history; `phase` is `started`, `finished`, `failed` or `cancelled`. A `delegation` entry carries `artifactId` when the agent held one.
- `onInterimMessage` → `interim`.
- `onQuestion` → `question`, with `askerRole` besides `askerRoleName`, `closed: false`, and `recommendedIndex` and `timeout` (`expiresAt` in epoch milliseconds plus `durationMs`) while they apply. When a question times out, the open question is closed and a `warning` `notice` tells what was assumed (`No reply in <n> min, <role>: assumed the recommended answer: <option>.` or `no answer assumed`) before the next `question`.
- The `TurnResult` becomes `agent_response`.
- Steering and cancellation markers have no entry.

## Entry ids

`ConversationEntryService` (`web/services/conversation-entry.service.ts`) builds every entry. It owns the clock and the random ids, so the use cases and services that publish entries receive it through their constructors.

Entry ids are stable so the store and the client upsert by id, and each carries what makes it unique across the conversation; other entries get a random id:

- `thought:<turnId>:<role>:<id>` and `tool:<turnId>:<role>:<toolCallId>`: the `turnId` is generated for each `SendConversationMessageUseCase` turn execution, because thought and tool ids are unique only within one agent's stream, and a shared id would overwrite another turn's or agent's entry. A step streamed again within its turn updates in place.
- `delegation:<delegationId>:<phase>`: each delegation reaches the channel with a `delegationId` (UUID), and the `delegation` entry carries it as a required field. The `round` restarts at 1 in each turn, so an id built from it would overwrite the delegation of an earlier turn.

## Conversation state

- Conversation state belongs to the conversation, not to a turn. `WebConversationTurnsService` tracks the active turns of each conversation (`begin`, `markRunning`, `markQueued`, `end`) and derives the published state: `running` when any active turn is running, `queued` only when every active turn is queued, `idle` only when none is active.
- A state is published only when it changes, so overlapping turns never repeat `running` or `idle`.
- A turn removes itself when it ends, however it ends: a result (a `steered` one included, which leaves `running` to the turn that absorbed the prompt) or a thrown error, which also becomes a `notice` entry with level `error`.
- When the conversation becomes `idle` the service closes the questions still open, publishes `idle` and flushes the store.
- `conversation.history` reports the state published by the same events service, so it always matches the stream.

## Publishing and the draft

- `WebConversationEventsService.publishEntry` places the entry in the store, then broadcasts `conversation.entry` with the `position` the store returned, one entry of a conversation at a time, so the stream follows the order of the history and a client knows where each entry belongs. An entry the store refuses is logged and reaches no client. It keeps the state in memory.
- It also keeps the draft of each conversation in memory: the user-facing text of the CEO's response being written (`TurnRequest.onDraft`), broadcast as `conversation.draft { conversationId, text }` (whole text at every event, only when it changed) and never stored in the history.
- The draft is discarded (`text: ''`, sent right before the entry) by the entry that delivers the response (`interim`, `question` or an `agent_response` that is not `steered`) and when the conversation goes `idle`.
- `conversation.history` carries the current draft in `draft` when there is one, so a conversation opened mid-response resumes it.
- `WebConversationEventsService` records nothing after `onModuleDestroy`, because what dying turns report during a shutdown did not happen to the conversation.
