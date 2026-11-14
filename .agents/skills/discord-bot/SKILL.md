---
name: discord-bot
description: >
  Discord bot as the primary input adapter for AI agents. Covers the slash commands (/agent,
  /model, /profiles, /usage, /language, /agent-auth, /cancel, /shell), numbered selections and
  the agent login dialog, agent questions to the user, per-conversation threads, activity
  streaming, throttling and message splitting. Use when working with Discord messages,
  interactions, formatting or events.
---

# Discord Bot Integration

> **Maintaining this skill**
>
> Update this document whenever any rule described here changes. The criterion is not
> *which* rule — it is the nature of the change: a Discord bot guideline or convention
> changed → update; technical refactor that preserves the described pattern → leave it alone.

The `DiscordModule` module lives in `packages/server/src/modules/discord/` and acts as the first primary
entry port (*driving adapter*) of the system. It listens to messages and interactions,
routes prompts to the orchestrator with the initial persona `'CEO'`, streams activities
in real time and delivers the consolidated final response in the corresponding thread.

## Gateway Intents and Client Lifecycle

Management of the `discord.js` `Client` is centralized in `DiscordClientService`:

- **Required intents**:
  - `GatewayIntentBits.Guilds`: resolution of servers and channels;
  - `GatewayIntentBits.GuildMessages`: receiving messages in text channels and threads;
  - `GatewayIntentBits.MessageContent`: reading the text content of messages (Privileged Intent in the Discord Developer Portal);
  - `GatewayIntentBits.DirectMessages`: receiving direct and private messages (DM).
- **Required partials**:
  - `Partials.Channel` and `Partials.Message`: ensure events are received in DM channels not previously cached.
- **Bot permissions (Permissions Integer)**:
  - The default set of text and channel permissions totals the integer `380104727616` in the Discord permissions calculator.
- **Slash command registration**: In the `onApplicationBootstrap` hook, registers `/cancel`, `/model`, `/usage`, `/agent`, `/profiles` and `/language`, plus `/agent-auth` (`dmPermission: false`) only when `IAgentAuthPort.isEnabled()` is true, and `/shell` (string option `command`, `dmPermission: false`) only when `IAgentTurnPort.isShellCommandEnabled()` is true. With `DISCORD_GUILD_ID` set and the guild found, it registers only in the guild and clears the global commands (`application.commands.set([])`), because Discord would show each command twice. Without the variable, or when the guild is not found, it registers only globally.
- **Tolerance to a missing token**: If the `DISCORD_BOT_TOKEN` variable is not defined
  in the environment, the service must emit a warning via `Logger.warn` and not throw exceptions.
  The application must start normally in CI environments and unit tests.
- **Clean shutdown**: In the `onApplicationShutdown` hook, call `client.destroy()` to
  close active WebSocket connections to the Discord API. The hook only runs with
  `app.enableShutdownHooks()` in `main.ts`.

## Conversational Interaction Modes

### 1. Direct / Private Messages (DM)
- Messages originating in a DM (`message.channel.isDMBased()`) are processed directly without requiring an `@Bot` mention.
- It does not create threads (Discord does not support threads in DMs); it uses the DM channel itself to show progress and send responses.
- Maps `channelId = message.channelId` and `threadId = undefined` for the orchestrator.

### 2. Server Channels with Thread Isolation
To keep channels clean and concurrent conversations strictly isolated:

1. **Message filter**: Messages from bots (`message.author.bot`) must be
   discarded immediately.
2. **Trigger criteria**:
   - In regular guild channels: the bot only responds when explicitly mentioned
     (`message.mentions.has(clientUser, { ignoreEveryone: true, ignoreRoles: true })`).
     The default discord.js options count `@everyone`, `@here` and role mentions, which
     would make any announcement in the server open an agent session.
   - In DMs: every message is accepted.
   - In threads: responds if the thread is managed by the bot (`channel.ownerId === clientUser.id`),
     if the bot is mentioned in the message body, if there are agent questions awaiting
     an answer in the thread (`hasPendingQuestions`), if a language change waits for the next message in it
     (`DiscordConversationService.hasPendingLanguageChange`, opened by `/language`) or if there is a configuration selection open in it
     (`hasActiveConfigSelection`, awaited; opened by `/agent`, `/model` or `/profiles` in a thread not owned by the bot) or if the agent login dialog waits for a pick or a pasted code in it (`hasPendingAgentAuth`, opened by `/agent-auth`).
   - Messages without a mention in a regular channel are always ignored. A `/agent`, `/model` or `/profiles` selection
     in a regular channel happens in a bot thread, so no loose channel conversation is treated
     as an answer.
3. **Thread creation**: On receiving a mention in a regular channel, the handler creates a new
   thread from the message (`message.startThread({ name, autoArchiveDuration: 60 })`).
   The thread title uses the first 50 characters of the prompt.
4. **ID resolution for the Orchestrator**: `resolveConversationKey(channelId, channel)`
   (`utils/conversation-key.util.ts`), shared with `DiscordInteractionHandler`:
   - `channelId`: the ID of the thread's parent channel (`thread.parentId ?? thread.id`), or the channel itself outside threads;
   - `threadId`: the ID of the thread itself, absent in DMs;
   - `userId`: the identifier of the message author;
   - `agentRole`: invariably `'CEO'` for triage and initial orchestration.
5. **Queue and steering**: messages from a conversation with a turn in progress wait in the
   orchestrator queue. Via `onQueued`, the progress message shows
   `⏳ *Waiting for the previous task in this conversation to finish...*`. When the CEO agent supports
   steering, the message enters the running round and the turn ends with `status: 'steered'`.

## Input Resolution and Agent and Model Selection

Discord owns its conversation dialogs: the numbered menus, their state, the pending language request and the reading of typed numbers live in `modules/discord`, and the orchestrator knows none of them. `DiscordConversationService` is the handlers' entry point: `resolveInput`, `startAgentSelection`, `startConfigSelection`, `startProfilesSelection`, `cancelConfigSelection`, `hasActiveConfigSelection`, `requestLanguageChange`, `hasPendingLanguageChange` and `cancelLanguageChange`. It composes `ResolveConversationInputUseCase`, `StartAgentConfigSelectionUseCase`, `SubmitAgentConfigSelectionUseCase`, `CancelAgentConfigSelectionUseCase`, `AgentProfileListService` (builds the profile step), `LanguageChangeRequestService` and the in-memory `IAgentConfigSelectionStorePort` (a selection interrupted by a restart is discarded) on top of the orchestrator ports only (`IAgentConfigurationPort`, `IAgentTurnPort`, `IUserQuestionPort`); specs use their stubs from `orchestrator/testing/`. Menu models (`AgentConfigSelection`, `SelectionOption` with its 1-based `index`, and the resolution outcomes) are Discord models; `toSelectionOptions` numbers the orchestrator's `AgentOption`s.

Before running the turn, the handler validates and downloads the attachments and calls
`DiscordConversationService.resolveInput({ conversationId, prompt, attachments? })` with the message text
(empty when it carries only attachments) inside `DiscordTypingIndicator.during(channel, ...)`, because
answering a selection starts a disposable agent to list models or efforts and takes a few
seconds. The use case takes the text as typed and the attachments as downloaded, and decides what the message is, in this order: the answer to the open question (a whole number becomes `{ kind: 'option' }` when the question has options, any other text becomes `{ kind: 'text' }`, and the orchestrator's queue receives the structured answer), the code a running agent login waits for (`AgentAuthRequestService.loginAwaitingCode`), the pick of an agent to log in (digits `1..N`, `0` to cancel) while one is pending, the language when a request is pending, the answer to an open selection (digits `1..N`, comma-separated at the profile step, `0` to exit or go back), or a prompt to run. Without settings for the conversation it inherits the most recent ones (`IAgentConfigurationPort.ensureSettings`); with none ever saved it opens the `agent` selection with the message (`PendingMessage`: the text as typed and its attachments) kept in the selection, and runs it with those attachments once the selection is configured (`unavailable` becomes `execute`). The outcomes:

- `question`: sends `formatQuestion` with the next question and stops;
- `invalid_answer`: sends `formatInvalidAnswer` (valid range followed by the question) and stops;
- `answered`: sends `formatAnswersSent` and, when another agent is waiting, `formatQuestion` with its question, and stops;
- `selection` and `profiles_menu`: sends `formatSelection` (numbered list of agents, models, efforts or profiles) and stops;
- `profiles_updated`: sends `formatProfilesUpdated(updatedRoles, profile)` followed by the refreshed `formatSelection` and stops;
- `profiles_closed`: sends `formatProfilesClosed` and stops;
- `agent_auth_selected`: `DiscordConversationService.startAgentLogin` starts the login of the picked agent (see `/agent-auth`) and stops;
- `invalid_agent_auth_choice`: sends `formatInvalidAgentAuthChoice(count)` and stops; `agent_auth_closed`: sends `formatAgentAuthClosed` and stops;
- `agent_auth_code`: the text went to the login's stdin (`IAgentAuthPort.submitInput`). The handler deletes the user's message, because it carries a credential, and sends `formatAgentLoginCodeReceived`, or `formatAgentLoginCodeRejected` when the login no longer takes input. While an agent login dialog is open the `[Message Received]` log line hides the text;
- `invalid`: sends `formatInvalidSelection` (valid range followed by the list) and stops;
- `configured`: sends `formatConfigured` and stops;
- `execute`: if it carries `configured`, sends the confirmation and runs the resolved `prompt` (the pending prompt of the first message).

The selection starts on its own with the first message while there is no saved configuration, and is
reopened with `/agent` (starting from the agent), `/model` (model and effort of the current agent) or `/profiles` (profile list). `/agent` and `/model` overwrite every profile. The
state is per conversation (channel + thread).

The `formatSelection` header depends on the step (`AgentConfigSelection.step`):

- `profile`: `👥 **Choose the profiles to configure** — type numbers separated by commas, or 0 to exit:`;
- `agent`: `🤖 **Choose the agent** by replying with the option number:`;
- `model`: `🧠 **Choose the <selectedAgent.name> model** by replying with the option number:`,
  or `🧠 **Choose the agent model** ...` without `selectedAgent`;
- `effort`: `⚡ **Choose the effort for <selectedModel.name>** by replying with the option number:`.

The agent, model and effort steps of a selection with `targetRoles` add `Type 0 to go back to the profile list.` to the header.

`formatConfigured(settings)` confirms, for every profile written by /agent, /model and the first-message selection, the CEO profile (or the first profile when none is the CEO) with `✅ **Settings saved for all profiles**: 🤖 <agentName> · 🧠 <modelName> · ⚡ <effortName>`,
with `default` when the model or the effort is null. `formatProfilesUpdated` confirms `✅ **Profiles updated** (<roles>): 🤖 ... · 🧠 ... · ⚡ ...` and `formatProfilesClosed` replies `✅ **Profile configuration closed.**`.

## Agent Questions to the User

Any agent can ask the user directly (see the `orchestrator` skill). While there are
pending questions, the conversation is locked as in the selection: every message is an answer, with or without
attachments, and nothing reaches the CEO.

- **First question**: the turn's `onQuestion` callback, on an `asked` event, posts `formatQuestion(prompt)` in the same
  queue as the delegation announcements and interim messages, so it appears after the notice that
  the agent took over the task. It calls `keepAlive()` like the other callbacks. If sending fails, the
  error is logged and the flow proceeds.
- **Following questions**: arrive as the `resolveInput` outcome on the message that answered the previous one.
- **Timeout**: a `timedOut` event posts `formatQuestionTimedOut(event)` (`⏱️ **No reply in <n> min** · <roleName> (\`<project>\`) — assumed the recommended answer **<n>. <option>**`, or `no answer assumed, the agent decides how to proceed`, plus the question in a `-#` line) and then `formatQuestion(next)` when another question follows. `formatQuestion` marks the recommended option with `_(recommended)_` and, while the timeout is enabled, adds `-# ⏱️ Without a reply <t:<unix>:R>, ...` with a Discord relative timestamp.
- **`formatQuestion(prompt)`**: the agent's free text (only on the first question), followed by
  `❓ **Question <n>/<total>** · <roleName> (\`<project>\`)`, the question text in bold, the
  `rationale` in italics after "Why it matters:", the numbered options (`**1.** ...`) and a `-#` line explaining that one
  answers with the number or with other text and that `/cancel` interrupts everything. With other agents in the
  queue, it appends `-# ⏳ <n> more agent(s) waiting for answers after this one.`
- **`formatInvalidAnswer(prompt)`**: `⚠️ Invalid option. Reply with a number from 1 to <N> or type
  another answer.` followed by the question, without the agent's free text.
- **`formatAnswersSent(asker)`**: `✅ Answers sent to **<roleName>** (\`<project>\`).`
- **Attachments as an answer**: the message's files are downloaded to the temporary attachments directory and
  go with the answer to the agent, which receives the path of each one.

## Response Footer

Every turn outcome with `TurnResult.agentInfo` gets the footer
`formatAgentFooter(info, usage?)`: `-# 🤖 <role> (<agent>) · 🧠 <model> · ⚡ <effort>`, with `default`
when the model or the effort is not known. With `TurnResult.usage`, the footer ends with
`· 🪙 <total> tokens`, abbreviated as `k`/`M`.

Every outcome is split with `splitMessage(text, 2000 - footer.length - 1)`, and the footer goes
on a new line of the last chunk. This also applies to failure, because `errorMessage` may
carry the agent's full stderr:

- **Completed**: the text is the response; with no text, `✅ *Task completed with no response message.*`.
- **Cancelled**: `⚠️ **Turn cancelled by the user.**`.
- **Steering**: `📨 *Message sent to the running agent. The reply will come with the current task's response.*`, with no footer and no splitting: the message entered the running CEO round and the response arrives in that turn's outcome.
- **Failure**: `❌ **Execution error**: <errorMessage>`.

When `TurnResult.attachments` contains existing local files, they are sent in the `files` parameter of the last message sent.

## Receiving and Storing Attachments

The bot accepts files attached directly to Discord messages through `DiscordAttachmentService`:

- **Attachment-only messages**: Messages with no text but with attachments are processed normally, with no "Empty Prompt" discard: the handler sends the empty text to `resolveInput`, which uses the prompt `The user sent attachments. Analyze the attached files.` for the turn, or takes the attachments as the answer when a question is pending.
- **Upfront compatibility validation**:
  - Accepts multiple formats readable by the agent's tools (images `.png`, `.jpg`, `.webp`, `.gif`, documents `.pdf`, text and code `.txt`, `.md`, `.json`, `.ts`, `.py`, etc., audio, video and configuration files such as `Dockerfile` and `.env`).
  - Maximum limit of 100 MB per attachment.
  - Blocks executable or non-analyzable binary files (`.exe`, `.bin`, `.dll`, `.so`, `.zip`, etc.). On identifying an incompatible file, it stops the flow immediately and sends a friendly warning in the channel before starting the turn.
- **Audio**: the handler does not inspect or convert audio. Voice messages (`.ogg`/Opus) and audio files travel like any other attachment: the handler downloads them, `resolveInput` carries them, and `executeTurn` receives them; the orchestrator transcribes them. The handler shows the result through `TurnRequest.onTranscription`, sending each warning as is and echoing the transcripts with `DiscordActivityFormatter.formatTranscripts` (`🎙️ **<file>**` followed by the quoted text), which also covers audio sent as the answer to an agent's question.
- **Secure temporary storage**:
  - Valid attachments are downloaded from the Discord CDN to an operating system temporary directory (`os.tmpdir()/agent-remote-control/attachments/<conversationKey>`).
  - Sanitization against *path traversal* via `path.basename` and a unique prefix with timestamp and random identifier.
  - Structured forwarding as `TurnAttachment[]` in the `attachments` field of `TurnRequest` when calling `agentTurn.executeTurn`.

An exception while processing the message is reported with
`❌ **An error occurred while processing your request:** <message>`, also split; if that
send fails, the failure is only logged.

## Activity Streaming and Formatting

While the turn runs, agent activities are captured via the `onActivity` callback
and formatted by `DiscordActivityFormatter`:

- **Thoughts (`thought`)**: delivered in full (no 5-line limit), formatted as a Discord quote block with emoji (`> 💭 *<text>*`), split into blocks of up to 2,000 characters via `splitMessage`. Real-time updates are synchronized in the channel by replacing/editing existing messages via `DiscordThrottler` (1,500ms interval against 429 rate limits).
- **Tools (`tool`)**: each tool call generates individual messages in the thread:
  - At start (`in_progress`): sends the message `⏳ **Running**: \`<title>\``.
  - On completion (`completed` or `failed`): edits that same message to `✅ **Completed**: \`<title>\`` or `❌ **Failed**: \`<title>\``, accompanied by a code block with up to 5 lines of details (arguments or output). If the details have more than 5 lines, shows the first 5 followed by `... (+N lines)`.
- **Delegation**: `onDelegation` releases the pending throttler (`flush()`), sends the `formatDelegation(event)` announcement in event order. On `started`, the notice says which agent took over, with name and role (e.g. `DEVELOPER`), the project and the artifact it holds (``on `T-3` ``); on `finished`, the delegate's response is posted with `formatDelegateResult(event)`, which also names the project to distinguish parallel delegations of the same role, and the footer `formatDelegateFooter(event)` (the same as `formatAgentFooter` with the delegate's agent, model, effort and tokens, plus `· ⏱️ <duration>`), split like final responses, and the notice says the CEO is reviewing. `cancelled` announces nothing, because the turn's own result reports the cancellation. If the announcement fails, the error is logged and the flow proceeds.
- **CEO interim message**: `onInterimMessage` posts the text the CEO wrote outside the tags in a response that delegates, split like final responses and with no footer, in the same queue as the delegation announcements, which is why it appears before the notice that the agent took over. If sending fails, the error is logged and the flow proceeds.

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
- Intermediate calls while a request is in flight are *coalesced*,
  keeping only the most recent state.
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

Slash commands are intercepted by `DiscordInteractionHandler`:

- **/cancel**: locates the interaction's channel and thread, calls `cancelConfigSelection`, `cancelAgentAuth`, `cancelLanguageChange` and then `cancelTurn`, which also discards pending questions and unlocks the conversation. With a turn in progress or pending questions, replies `🛑 **Cancellation requested.** The active turn will be stopped.`; with only a closed selection (of agent, model, effort, language or login, a running login included), `🛑 **Selection cancelled.**`; with neither, `ℹ️ There is no turn in progress to cancel.` The reply is ephemeral.
- **/model**, **/agent**, **/profiles**, **/language** and **/agent-auth** in a conversation with pending questions (DM or thread) reply ephemerally `❓ There are questions waiting for your answer in this conversation. Answer them or use /cancel before switching agent, model, language or login.` without opening the selection. In a guild channel the selection opens another conversation, in a new thread, and is not blocked.
- **/model**: public `deferReply()`. The options are answered by message in the conversation, which is why the reply is public:
  - In a guild channel: `editReply('🧵 Choose the model in the thread below.')`, a thread created from that notice (`startThread({ name: 'Model selection', autoArchiveDuration: 60 })`), `startConfigSelection(conversationId)` with the typing indicator in the thread (`DiscordTypingIndicator.during`) and `formatSelection` split inside the thread. The thread belongs to the bot, so answers come in without a mention and, after configuring, it continues as a normal conversation. If the thread cannot be created, replies `❌ **Failed to open model selection**: <error>`.
  - In a DM or thread: `startConfigSelection` with the current conversation key and `editReply(formatSelection)`; the deferred reply already shows "thinking..." during the query.
  - With `unavailable`, posts `ℹ️ The current agent does not expose any models to select.` in the same destination as the options.
- **/shell**: adapter over `IAgentTurnPort.runShellCommand(conversationId, command)`; the handler holds no rule (flag, working directory, timeout and output limit live in the orchestrator). Replies ephemerally (`deferReply({ ephemeral: true })`) with `formatShellResult(result)`: a code block with `$ <command>` and the output, followed by `✅ **Exit code 0**`, `❌ **Exit code N**`, `⏱️ **Timed out**` or `🛑 **Cancelled**`, plus `output truncated to the last characters` when applicable. Code fences in the command or output are neutralized. Failure (including `ShellCommandDisabledError`) replies `❌ **Failed to run command**: <error>`.
- **/usage**: replies ephemerally (`deferReply({ ephemeral: true })`) with `formatQuota(await agentTurn.getQuota())`, the usage of every available agent: one section per agent, `📊 **<agent> usage**` followed by one line per bucket (`<marker> <bar> <N>% <label> · resets <t:unix:R>`). `<bar>` is 10 characters of `▰`/`▱` for the used fraction (`0%` when the limit is untouched, `100%` when exhausted) and `<marker>` is 🟢 from 50%, 🟡 from 20% and 🔴 below. `<label>` comes from the bucket `window` (`5h`, `Week` for `7d`/`weekly`, `Month` for `monthly`) and falls back to the bucket name. `GetAgentQuotaUseCase` orders the buckets of each group from the shortest window to the longest, those without a known duration last, so every agent and channel lists them alike. The group name (`**<group>**`) appears only when the agent has more than one group. An agent without a quota shows `ℹ️ This agent does not expose usage information.`, one that failed or timed out shows `ℹ️ Usage could not be queried.`, and no available agent replies `ℹ️ No agent CLI was found in the PATH.` The text is split with `splitMessage`: the first chunk is the `editReply` and the rest are ephemeral `followUp`s. Failure replies `❌ **Failed to fetch usage**: <error>`.
- **/agent**: same flow as `/model`, with `startAgentSelection(conversationId)`, which opens the selection at the `agent` step listing only agents whose CLI is in the `PATH`; once the agent is chosen, model and effort follow through the same numbered reply. In a guild channel the notice is `🧵 Choose the agent in the thread below.` and the thread is named `Agent selection`. Failure replies `❌ **Failed to open agent selection**: <error>` and `unavailable` posts `ℹ️ No agents available to select.`
- **/profiles**: same flow as `/model`, with `startProfilesSelection(conversationId)`, which opens the `profile` step listing each role with its `<agent> - <model> - <effort>`. The user replies with comma-separated numbers, then chooses agent, model and effort for those roles; the list reappears after each save and `0` exits (or goes back one level inside a role selection). In a guild channel the notice is `🧵 Configure the profiles in the thread below.` and the thread is named `Profile configuration`. `unavailable` posts `ℹ️ No profiles available to configure.` A profile row whose saved agent is not in the `PATH` reads `<agent> (not installed) - <model> - <effort>`.
- **/language**: same flow as `/model`, with `requestLanguageChange(conversationId)`, which marks the conversation so its next message is the language and resolves to the current one. Publishes `🌐 **Current language**: <language>` with the instruction to reply with the language name. In a guild channel the notice is `🧵 Choose the language in the thread below.` and the thread is named `Language selection`. Failure replies `❌ **Failed to open language selection**: <error>`. The next message resolves to `language_set`, answered with `✅ **Language saved**: <language>`, or `invalid_language`, answered with `⚠️ Invalid language. ...` while the request stays open. The language applies to the text agents write for the user in every conversation; the bot's own messages are English.
- **/agent-auth**: same flow as `/model`, with `startAgentAuthSelection(conversationId)`, which lists the agents with a CLI login (`IAgentAuthPort.listAuthInfo`, so an agent without one, such as OpenCode, is not offered) and marks the conversation as waiting for the pick. `formatAgentAuthMenu` shows `**<n>.** <agent> — ✅ logged in (<account>)`, `⚠️ not logged in` or `❔ status unknown`, and `0` cancels. In a guild channel the notice is `🧵 Choose the agent to log in in the thread below.` and the thread is named `Agent login`; `unavailable` posts `ℹ️ No agents with a CLI login are available.` and failure replies `❌ **Failed to open login selection**: <error>`. The command is registered with `dmPermission: false` and only while `AGENT_AUTH_ENABLED` is not `false`.
  - **Login**: the pick (`agent_auth_selected`) starts `DiscordAgentAuthNotifierService.start`, which calls `IAgentAuthPort.startLogin` and posts into the thread or DM the user answered in, in order: `formatAgentLoginStarting`, `formatAgentLoginLink` (the link, the one-time code when the CLI prints one, and the waiting notice), `formatAgentLoginPrompt` when the CLI waits for a pasted code (Claude and Antigravity), and `formatAgentLoginResult` (`✅ **<agent>** is logged in.`, `❌ **<agent> login failed**: <reason>` or `🛑 **<agent> login cancelled.**`). The link and the code are posted in the thread because the user answers there and a later message cannot be ephemeral; the thread is the bot's own, so only its members see them. While the prompt is open every message in the conversation is the code until the login ends (Claude keeps waiting after a wrong code; Antigravity ends the login with its failure message), `/cancel` ends it, and the login's own timeout (`AGENT_AUTH_LOGIN_TIMEOUT_MS`) ends an abandoned one. The link, the code and the pasted text never reach the log: it only records the outcome.
- **Guarded replies**: every reply goes through a single method that uses `editReply` when the interaction was deferred, `followUp` when already replied and `reply` otherwise, and only logs send failures. The `InteractionCreate` listener chains `.catch(...)` with logging, and `main.ts` registers `process.on('unhandledRejection')` as a safety net: an unhandled rejection would bring down the process.
