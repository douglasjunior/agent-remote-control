# Interactions and Slash Commands

Slash commands are intercepted by `DiscordInteractionHandler`.

## Common behavior

- **Pending questions block the menus**: `/model`, `/agent`, `/profiles`, `/language` and `/agent-auth` in a conversation
  with pending questions (DM or thread) reply ephemerally
  `❓ There are questions waiting for your answer in this conversation. Answer them or use /cancel before switching agent, model, language or login.`
  without opening the selection. In a guild channel the selection opens another conversation, in a new thread, and is
  not blocked.
- **Menu commands share the `/model` flow**: public `deferReply()`, because the options are answered by message in the
  conversation.
  - In a guild channel: `editReply(<notice>)`, a thread created from that notice
    (`startThread({ name: <thread name>, autoArchiveDuration: 60 })`), the command's start method with the typing
    indicator in the thread (`DiscordTypingIndicator.during`) and the menu split inside the thread. The thread belongs
    to the bot, so answers come in without a mention and, after configuring, it continues as a normal conversation. If
    the thread cannot be created, replies the command's failure message.
  - In a DM or thread: the start method with the current conversation key and `editReply(<menu>)`; the deferred reply
    already shows "thinking..." during the query.
- **Guarded replies**: every reply goes through a single method that uses `editReply` when the interaction was deferred,
  `followUp` when already replied and `reply` otherwise, and only logs send failures. The `InteractionCreate` listener
  chains `.catch(...)` with logging, and `main.ts` registers `process.on('unhandledRejection')` as a safety net: an
  unhandled rejection would bring down the process.

## Menu commands

| Command | Start method | Guild notice | Thread name | `unavailable` | Failure |
|---|---|---|---|---|---|
| `/model` | `startConfigSelection` | `🧵 Choose the model in the thread below.` | `Model selection` | `ℹ️ The current agent does not expose any models to select.` | `❌ **Failed to open model selection**: <error>` |
| `/agent` | `startAgentSelection` | `🧵 Choose the agent in the thread below.` | `Agent selection` | `ℹ️ No agents available to select.` | `❌ **Failed to open agent selection**: <error>` |
| `/profiles` | `startProfilesSelection` | `🧵 Configure the profiles in the thread below.` | `Profile configuration` | `ℹ️ No profiles available to configure.` | `❌ **Failed to open profile selection**: <error>` |
| `/language` | `requestLanguageChange` | `🧵 Choose the language in the thread below.` | `Language selection` | — | `❌ **Failed to open language selection**: <error>` |
| `/agent-auth` | `startAgentAuthSelection` | `🧵 Choose the agent to log in in the thread below.` | `Agent login` | `ℹ️ No agents with a CLI login are available.` | `❌ **Failed to open login selection**: <error>` |

The `unavailable` message is posted in the same destination as the options.

- **/model**: opens the model and effort steps of the current agent, with `formatSelection`.
- **/agent**: opens the selection at the `agent` step listing only agents whose CLI is in the `PATH`; once the agent is
  chosen, model and effort follow through the same numbered reply.
- **/profiles**: opens the `profile` step listing each role with its `<agent> - <model> - <effort>`; a profile row whose
  saved agent is not in the `PATH` reads `<agent> (not installed) - <model> - <effort>`. The user replies with
  comma-separated numbers, then chooses agent, model and effort for those roles; the list reappears after each save and
  `0` exits (or goes back one level inside a role selection).
- **/language**: marks the conversation so its next message is the language and resolves to the current one. Publishes
  `🌐 **Current language**: <language>` with the instruction to reply with the language name. The next message
  resolves to `language_set`, answered with `✅ **Language saved**: <language>`, or `invalid_language`, answered with
  `⚠️ Invalid language. ...` while the request stays open. The language applies to the text agents write for the user
  in every conversation; the bot's own messages are English.
- **/agent-auth**: lists the agents with a CLI login (`IAgentAuthPort.listAuthInfo`, so an agent without one, such as
  OpenCode, is not offered) and marks the conversation as waiting for the pick. `formatAgentAuthMenu` opens with
  `🔑 **Choose the agent to log in** by replying with the option number, or 0 to cancel:` and shows
  `**<n>.** <agent> — ✅ logged in (<account>)`, `⚠️ not logged in` or `❔ status unknown`. The command is registered
  with `dmPermission: false` and only while `AGENT_AUTH_ENABLED` is not `false`.

## Agent login

The pick (`agent_auth_selected`) starts `DiscordAgentAuthNotifierService.start`, which calls `IAgentAuthPort.startLogin`
and posts into the thread or DM the user answered in, in order:

1. `formatAgentLoginStarting`;
2. `formatAgentLoginLink`: the link, the one-time code when the CLI prints one, and the waiting notice;
3. `formatAgentLoginPrompt` when the CLI waits for a pasted code;
4. `formatAgentLoginResult`: `✅ **<agent>** is logged in.`, `❌ **<agent> login failed**: <reason>` or
   `🛑 **<agent> login cancelled.**`.

The link and the code are posted in the thread because the user answers there and a later message cannot be
ephemeral; the thread is the bot's own, so only its members see them. While the prompt is open every message in the
conversation is the code until the login ends, `/cancel` ends it, and the login's own timeout
(`AGENT_AUTH_LOGIN_TIMEOUT_MS`) ends an abandoned one. The link, the code and the pasted text never reach the log: it
only records the outcome.

## Other commands

- **/cancel**: locates the interaction's channel and thread, calls `cancelConfigSelection`, `cancelAgentAuth`,
  `cancelLanguageChange` and then `IAgentTurnPort.cancelTurn`, which also discards pending questions and unlocks the
  conversation. With a turn in progress or pending questions, replies
  `🛑 **Cancellation requested.** The active turn will be stopped.`; with only a closed selection (of agent, model,
  effort, language or login, a running login included), `🛑 **Selection cancelled.**`; with neither,
  `ℹ️ There is no turn in progress to cancel.` The reply is ephemeral.
- **/shell**: adapter over `IAgentTurnPort.runShellCommand(conversationId, command)`; the handler holds no rule (flag,
  working directory, timeout and output limit belong to the port). Replies ephemerally
  (`deferReply({ ephemeral: true })`) with `formatShellResult(result)`: a code block with `$ <command>` and the output,
  followed by `✅ **Exit code 0**`, `❌ **Exit code N**`, `⏱️ **Timed out**` or `🛑 **Cancelled**`, plus
  `output truncated to the last characters` when applicable. Code fences in the command or output are neutralized.
  Failure (including `ShellCommandDisabledError`) replies `❌ **Failed to run command**: <error>`.
- **/usage**: replies ephemerally (`deferReply({ ephemeral: true })`) with `formatQuota(await agentTurn.getQuota())`,
  the usage of every available agent, with the buckets in the order the port returns them:
  - one section per agent, `📊 **<agent> usage**` followed by one line per bucket
    (`<marker> <bar> <N>% <label> · resets <t:unix:R>`);
  - `<bar>` is 10 characters of `▰`/`▱` for the used fraction (`0%` when the limit is untouched, `100%` when
    exhausted) and `<marker>` is 🟢 from 50%, 🟡 from 20% and 🔴 below;
  - `<label>` comes from the bucket `window` (`5h`, `Week` for `7d`/`weekly`, `Month` for `monthly`) and falls back to
    the bucket name;
  - the group name (`**<group>**`) appears only when the agent has more than one group;
  - an agent without a quota shows `ℹ️ This agent does not expose usage information.`, one that failed or timed out
    shows `ℹ️ Usage could not be queried.`, and no available agent replies `ℹ️ No agent CLI was found in the PATH.`

  The text is split with `splitMessage`: the first chunk is the `editReply` and the rest are ephemeral `followUp`s.
  Failure replies `❌ **Failed to fetch usage**: <error>`.
