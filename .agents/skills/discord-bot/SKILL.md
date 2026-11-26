---
name: discord-bot
description: >
  Discord bot as the primary input adapter for AI agents. Covers the slash commands (/agent,
  /model, /profiles, /squad, /usage, /language, /agent-auth, /cancel, /shell), numbered selections and
  the agent login dialog, agent questions to the user, per-conversation threads, activity
  streaming, throttling, message splitting, and the client that restarts when the Discord
  settings change and tests a bot token. Use when working with Discord messages,
  interactions, formatting, events, the bot token or the client connection.
---

# Discord Bot Integration

> **Maintaining this skill**
>
> Update this document whenever any rule described here changes. The criterion is not
> *which* rule — it is the nature of the change: a Discord bot guideline or convention
> changed → update; technical refactor that preserves the described pattern → leave it alone.

The `DiscordModule` module lives in `packages/server/src/modules/discord/` and acts as the first primary
entry port (*driving adapter*) of the system. It listens to messages and interactions,
routes prompts to the orchestrator (`IAgentTurnPort.executeTurn`) with the initial persona `'CEO'`, streams activities
in real time and delivers the consolidated final response in the corresponding thread.

## Reference files

- [references/input-resolution.md](references/input-resolution.md): `DiscordConversationService`, the order in which
  `resolveInput` reads a message, every outcome and what the handler sends for it, and the selection steps and their
  headers. Read it when changing how a message is interpreted or a numbered menu.
- [references/slash-commands.md](references/slash-commands.md): each slash command, its notices, thread names,
  failure messages and the agent login dialog. Read it when adding or changing a command.
- [references/message-formats.md](references/message-formats.md): the exact text of questions, activities,
  delegation announcements, the response footer and each turn outcome. Read it when changing what a turn posts.

## Gateway Intents and Client Lifecycle

Management of the `discord.js` `Client` is centralized in `DiscordClientService`:

- **Required intents**:
  - `GatewayIntentBits.Guilds`: resolution of servers and channels;
  - `GatewayIntentBits.GuildMessages`: receiving messages in text channels and threads;
  - `GatewayIntentBits.MessageContent`: reading the text content of messages (Privileged Intent in the Discord Developer Portal);
  - `GatewayIntentBits.DirectMessages`: receiving direct and private messages (DM).
- **Required partials**: `Partials.Channel` and `Partials.Message` ensure events are received in DM channels not previously cached.
- **Bot permissions (Permissions Integer)**: the default set of text and channel permissions totals the integer `380104727616` in the Discord permissions calculator.
- **Connection lifecycle**: `start()`, `stop()` and `restart()` run one after the other, and a step that failed is logged
  and does not skip the steps behind it. `onApplicationBootstrap`
  calls `start()`, which logs in with the `DISCORD_BOT_TOKEN` setting when `DISCORD_ENABLED` (default `true`) is on and
  then registers the slash commands; it never rejects, so a bot that cannot log in leaves the server running. A change of
  `DISCORD_ENABLED`, `DISCORD_BOT_TOKEN` or `DISCORD_GUILD_ID` (`ISettingsChangeNotifierPort`) restarts the client, and a
  change of `AGENT_AUTH_ENABLED` registers the commands again while it is connected.
- **One client per login**: a client that has logged in, or tried to, is never logged in again, because discord.js keeps
  a destroyed gateway from reconnecting and keeps the caches of the previous bot. A restart destroys it and builds a new
  one. Handlers register their listeners once with `DiscordClientService.on(event, listener)`, which attaches them to
  every client, and read `getClient()` at each use, never keeping the client.
- **Slash command registration**: once logged in, registers `/cancel`, `/model`, `/usage`, `/agent`, `/profiles`, `/squad` and `/language`, plus `/agent-auth` (`dmPermission: false`) only when `IAgentAuthPort.isEnabled()` is true, and `/shell` (string option `command`, `dmPermission: false`) only when `IAgentTurnPort.isShellCommandEnabled()` is true. With the `DISCORD_GUILD_ID` setting and the guild found, it registers only in the guild and clears the global commands (`application.commands.set([])`), because Discord would show each command twice. Without it, or when the guild is not found, it registers only globally.
- **Tolerance to a missing token**: while the `DISCORD_BOT_TOKEN` setting is empty (an environment variable set empty
  counts), the service emits a warning via `Logger.warn` and does not throw. The application must start normally in CI
  environments and unit tests.
- **Connection test**: `TestDiscordConnectionUseCase` (exported for the web settings page) tests the token typed in the
  form before it is saved, or the saved one when none is typed, and the form's server id (the saved one when absent, none
  when empty) through `IDiscordConnectionTesterPort`. `RestDiscordConnectionTesterAdapter` asks discord.js `REST` for
  `GET /users/@me` and, with a server id, `GET /guilds/{id}`, and answers `{ ok: true, botName, guildName? }` or
  `{ ok: false, error }` in words for the user (a refused token, a bot that is not in the server, or Discord unreachable).
  The token never reaches a log.
- **Clean shutdown**: in the `onApplicationShutdown` hook, stop following the settings and call `client.destroy()` to
  close active WebSocket connections to the Discord API. The hook only runs with
  `app.enableShutdownHooks()` in `main.ts`.

## Conversational Interaction Modes

### 1. Direct / Private Messages (DM)
- Messages originating in a DM (`message.channel.isDMBased()`) are processed directly without requiring an `@Bot` mention.
- It does not create threads (Discord does not support threads in DMs); it uses the DM channel itself to show progress and send responses.
- Maps `channelId = message.channelId` and `threadId = undefined` for the orchestrator.

### 2. Server Channels with Thread Isolation
To keep channels clean and concurrent conversations strictly isolated:

1. **Message filter**: messages from bots (`message.author.bot`) must be discarded immediately.
2. **Trigger criteria**:
   - In regular guild channels: the bot only responds when explicitly mentioned
     (`message.mentions.has(clientUser, { ignoreEveryone: true, ignoreRoles: true })`).
     The default discord.js options count `@everyone`, `@here` and role mentions, which
     would make any announcement in the server open an agent session.
   - In DMs: every message is accepted.
   - In threads: responds if the thread is managed by the bot (`channel.ownerId === clientUser.id`),
     if the bot is mentioned in the message body, if there are agent questions awaiting
     an answer in the thread (`hasPendingQuestions`), if a failed turn waits to be retried (`hasPendingRetry`), if a language change waits for the next message in it
     (`DiscordConversationService.hasPendingLanguageChange`, opened by `/language`), if there is a configuration
     selection open in it (`hasActiveConfigSelection`, awaited; opened by `/agent`, `/model`, `/profiles` or `/squad` in a
     thread not owned by the bot) or if the agent login dialog waits for a pick or a pasted code in it
     (`hasPendingAgentAuth`, opened by `/agent-auth`).
   - Messages without a mention in a regular channel are always ignored. A `/agent`, `/model`, `/profiles` or `/squad` selection
     in a regular channel happens in a bot thread, so no loose channel conversation is treated as an answer.
3. **Thread creation**: on receiving a mention in a regular channel, the handler creates a new
   thread from the message (`message.startThread({ name, autoArchiveDuration: 60 })`).
   The thread title uses the first 50 characters of the prompt.
4. **ID resolution for the Orchestrator**: `resolveConversationKey(channelId, channel)`
   (`utils/conversation-key.util.ts`), shared with `DiscordInteractionHandler`:
   - `channelId`: the ID of the thread's parent channel (`thread.parentId ?? thread.id`), or the channel itself outside threads;
   - `threadId`: the ID of the thread itself, absent in DMs;
   - `userId`: the identifier of the message author;
   - `agentRole`: invariably `'CEO'` for triage and initial orchestration.
5. **Messages during a turn**: a message sent while the conversation has a turn in progress joins that turn in the
   orchestrator; the handler follows `onDelivery`, shows the waiting notice while it is `queued`, and a result with
   `status: 'steered'` (or a message cancelled before the CEO read it) gets a notice in place of a response.

## Input Resolution and Selection

Discord owns its conversation dialogs: the numbered menus, their state, the pending language request, the agent login
dialog and the reading of typed numbers live in `modules/discord`, and the orchestrator knows none of them.
`DiscordConversationService` is the handlers' entry point, built on the orchestrator ports (`IAgentConfigurationPort`,
`IAgentTurnPort`, `IUserQuestionPort`, `ITurnRetryPort`) and `IAgentAuthPort` only; specs use their stubs from `orchestrator/testing/`.

Before running the turn, the handler validates and downloads the attachments and calls `resolveInput` inside
`DiscordTypingIndicator.during(channel, ...)`. A message is, in this order: the answer to the open question, the
pending language, the code a running agent login waits for, the pick of an agent to log in, the answer to an open
selection, or a prompt to run. A conversation without saved settings takes the default squad, else inherits the most
recent settings; with neither, the first message opens the `agent` selection and runs once it is configured. Selection state is per
conversation (channel + thread) and in memory
([references/input-resolution.md](references/input-resolution.md)).

## Agent Questions to the User

While there are pending questions, the conversation is locked as in the selection: every message is an answer, with
or without attachments, and nothing reaches the CEO.

- **First question**: the turn's `onQuestion` callback, on an `asked` event, posts `formatQuestion(prompt)` in the same
  queue as the delegation announcements and interim messages, so it appears after the notice that the agent took over
  the task. It calls `keepAlive()` like the other callbacks.
- **Following questions**: arrive as the `resolveInput` outcome on the message that answered the previous one.
- **Timeout**: a `timedOut` event posts `formatQuestionTimedOut(event)` and then `formatQuestion(next)` when another
  question follows.
- **Attachments as an answer**: the message's files are downloaded to the temporary attachments directory and go with
  the answer to the agent, which receives the path of each one.

## A Failed Turn Waiting to Be Retried

When a prompt of the CEO fails, the orchestrator waits and tries again (see the orchestrator skill). The turn's `onRetry` callback, on a `scheduled` event, posts `formatRetry(prompt)`: the failure and `-# ⏱️ Trying again automatically <t:...:R> (attempt n). Send any message to continue now, or /cancel to stop.`, in the same queue as the other announcements. An `ended` event posts nothing.

- **Any message continues**: while a retry waits, `resolveInput` takes the next message (text and attachments) as the request to retry now (`ITurnRetryPort.retryNow`), after an open question, a pending language, a login or a selection have had theirs. The outcome is `retry_requested`: the handler sends `formatRetryRequested` and runs no turn; the CEO reads the message with the retry.
- **`/cancel`** cancels the turn, the wait included.

## Turn Output

While the turn runs, the handler posts what the `TurnRequest` callbacks report, formatted by `DiscordActivityFormatter`
(texts in [references/message-formats.md](references/message-formats.md)):

- `onActivity`: thoughts and tool calls through `DiscordThrottler`; skill reads and writes right away, outside it.
- `onDelegation`: releases the pending throttler (`flush()`) and sends the announcement in event order; on `finished`
  it also posts the delegate's response with its footer.
- `onInterimMessage`: the CEO's interim text, in the same queue as the delegation announcements, so it appears before
  the notice that the agent took over.
- `onTranscription`: each warning as is and the transcripts, also for audio sent as the answer to a question.
- `onQuestion` and `onRetry` post their messages the same way. The callbacks that send a message share `announce`, which keeps the typing going, clears the initial progress message and chains the send after the pending ones.
- A failure to send one of these messages is logged and the flow proceeds.

Every turn outcome is split with `splitMessage(text, 2000 - footer.length - 1)`, and the footer goes on a new line of
the last chunk. This also applies to failure, because `errorMessage` may carry the agent's full stderr. The steering
notice has no footer and no splitting. When `TurnResult.attachments` contains existing local files, they are sent in
the `files` parameter of the last message sent. An exception while processing the message is reported, also split;
if that send fails, the failure is only logged.

## Receiving and Storing Attachments

The bot accepts files attached directly to Discord messages through `DiscordAttachmentService`:

- **Attachment-only messages**: messages with no text but with attachments are processed normally, with no "Empty Prompt" discard: the handler sends the empty text to `resolveInput`, which uses the prompt `The user sent attachments. Analyze the attached files.` for the turn, or takes the attachments as the answer when a question is pending.
- **Upfront compatibility validation**:
  - Accepts multiple formats readable by the agent's tools (images `.png`, `.jpg`, `.webp`, `.gif`, documents `.pdf`, text and code `.txt`, `.md`, `.json`, `.ts`, `.py`, etc., audio, video and configuration files such as `Dockerfile` and `.env`).
  - Maximum limit of 100 MB per attachment.
  - Blocks executable or non-analyzable binary files (`.exe`, `.bin`, `.dll`, `.so`, `.zip`, etc.). On identifying an incompatible file, it stops the flow immediately and sends a friendly warning in the channel before starting the turn.
- **Audio**: the handler does not inspect or convert audio. Voice messages (`.ogg`/Opus) and audio files travel like any other attachment: the handler downloads them, `resolveInput` carries them, and `executeTurn` receives them; the orchestrator transcribes them and reports through `TurnRequest.onTranscription`.
- **Secure temporary storage**:
  - Valid attachments are downloaded from the Discord CDN to an operating system temporary directory (`os.tmpdir()/agent-remote-control/attachments/<conversationKey>`).
  - Sanitization against *path traversal* via `path.basename` and a unique prefix with timestamp and random identifier.
  - Structured forwarding as `TurnAttachment[]` in the `attachments` field of `TurnRequest` when calling `agentTurn.executeTurn`.

## Typing Indicator and Inactivity Watchdog

While a turn runs in `DiscordMessageHandler`, the visual typing feedback ("typing...") is managed by `DiscordTypingIndicator` (`services/discord-typing-indicator.service.ts`, a plain class the handler creates per turn):

- **Initial trigger and periodic repetition**: when processing of a turn starts, `start()` fires `sendTyping()` immediately in the channel and schedules repetitions every `8000ms` (`intervalMs` default). Rejections and exceptions in `sendTyping()` are silently suppressed.
- **Inactivity watchdog and keepalive**: an inactivity timer set to 5 minutes (`idleTimeoutMs` default) stops the triggers if no activity is recorded. The `onActivity`, `onDelegation`, `onInterimMessage` and `onQuestion` callbacks call `keepAlive()`, restarting the watchdog countdown on each new activity.
- **Short wait**: `DiscordTypingIndicator.during(channel, work)` keeps typing while `work` runs and calls `stop()` in `finally`, for waits outside a turn, such as querying agents, models and efforts for a selection.
- **Lifecycle shutdown**: `stop()` cancels the repetition and inactivity timers. The method is called in a `finally` block right after `executeTurn`, ensuring shutdown on successful completion, cancellation and failure.

## Throttling and Coalescing against Rate Limits (HTTP 429)

The Discord API imposes strict rate limits on message edits (approximately
1 edit per second per channel). Direct updates on every generating event would lead to 429 errors:

- Use `DiscordThrottler` (`services/discord-throttler.service.ts`) with a minimum interval of 1000ms to 1500ms between edit requests.
- Intermediate calls while a request is in flight are *coalesced*, keeping only the most recent state.
- When the turn ends, you must run `await throttler.flush()` to ensure
  the last status update is sent before the final response.
- Destroy the throttler via `throttler.destroy()` at the end of the cycle.

## Response Splitting (`splitMessage`)

Discord messages have a hard limit of 2000 characters. Texts exceeding this limit
are split by `DiscordActivityFormatter.splitMessage(content, maxLength)`:

- Splits the content respecting line breaks (`\n`).
- Preserves Markdown code blocks (\`\`\`): when a code block must be split
  across messages, the current message must close the block with \`\`\` and the next message
  must reopen the block with \`\`\`<lang> to preserve syntax formatting in the client.
- No individual generated part may exceed the `maxLength` limit. Each line only enters
  the current part if it fits together with the closing fence the block will still require after
  it, and lines larger than the available space are sliced by the same mechanism, preserving
  the code block state between slices.

## Local Links (`stripLocalLinks`)

Discord renders masked links only for web URLs, so agent links to local files
(`[text](file:///…#L51)`, absolute or relative paths) would show up raw. Before splitting,
`sendChunks` and thought formatting pass the text through `stripLocalLinks`, which keeps only
the link text (and the alt text of local images). Links to `http(s)://` and `mailto:` and
anything inside fenced code blocks stay untouched.

## Interactions and Slash Commands

`DiscordInteractionHandler` intercepts the slash commands
([references/slash-commands.md](references/slash-commands.md)):

- `/model`, `/agent`, `/profiles`, `/squad`, `/language` and `/agent-auth` open a dialog answered by message, in a new bot thread
  from a guild channel or in the DM or thread itself, where pending questions block them.
- The `/agent-auth` login posts its link and code only where the user answers, deletes the pasted code message, and
  never logs the link, the code or the pasted text.
- `/cancel` cancels the conversation's selection, language request, login and turn; `/usage` and `/shell` reply
  ephemerally, and `/shell` holds no rule of its own.
- **Guarded replies**: every reply goes through a single method that uses `editReply` when the interaction was
  deferred, `followUp` when already replied and `reply` otherwise, and only logs send failures. The `InteractionCreate`
  listener chains `.catch(...)` with logging, and `main.ts` registers `process.on('unhandledRejection')` as a safety
  net: an unhandled rejection would bring down the process.
