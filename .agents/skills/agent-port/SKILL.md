---
name: agent-port
description: >
  Integration pattern for AI agents via the Agent Client Protocol (ACP) and Ports &
  Adapters. Defines the IAgentPort contract, the session lifecycle (connect,
  createSession, loadSession, prompt, cancel, closeSession), resumption via session/load,
  lost-transport detection, the cancellation ladder with and without steering, the streaming
  demux, the multi-agent factory and the AntigravityAdapter, ClaudeCodeAdapter, CopilotAdapter, CodexAdapter and CursorAdapter adapters.
  Use when implementing, extending or consuming agents, ACP bridges, processes and streams.
---

# Agent Port and ACP Integration

> **Maintaining this skill**
>
> Update this document whenever any rule described here changes. The criterion is not
> which rule — it is the nature of the change: the communication protocol, session
> lifecycle or agent contract changed → update; internal cosmetic adjustment that
> preserves the consolidated rules → leave it alone.

## `IAgentPort` Contract

The `IAgentPort` port lives in `src/modules/agent/ports/agent.port.ts` and decouples
the application core from the technical details of communicating with AI agents.

Each `IAgentPort` instance represents one agent subprocess with a single ACP
session. Consumers obtain instances through the `IAgentPortFactory` factory
(`src/modules/agent/ports/agent-port-factory.port.ts`), registered in `AgentModule` with
`AcpAgentPortFactoryAdapter`:

```ts
@Inject(IAgentPortFactory) private readonly agentPortFactory: IAgentPortFactory

const agentPort = this.agentPortFactory.create('claude');
```

The factory exposes:

- `defaultAgentId: string` (a getter): agent used while no choice is saved — `'agy'` when available, otherwise the first available agent, otherwise `'agy'`;
- `listAgents(): readonly AgentProviderInfo[]`: full catalog (`agentId`, `displayName`) in display order — `agy` (Antigravity), `claude` (Claude Code), `copilot` (GitHub Copilot), `codex` (OpenAI Codex) and `cursor` (Cursor);
- `listAvailableAgents(): readonly AgentProviderInfo[]`: the catalog entries whose CLI is visible in the `PATH`, in catalog order;
- `isAgentAvailable(agentId: string): boolean`: whether that agent's CLI is visible in the `PATH`; `false` for an unknown ID;
- `create(agentId: string): IAgentPort`: new agent instance, built regardless of the `PATH`; throws `Unknown agent "<id>". Available agents: ...` for an ID outside the catalog.

**PATH visibility**: each catalog entry declares the binaries that identify it — `agy` → `agy`, `claude` → `claude`, `copilot` → `copilot`, `codex` → `codex`, `cursor` → `cursor-agent` or `agent` (`CURSOR_BINARIES`). Claude Code and Codex also need their CLI in the `PATH`, although they run through bundled npm bridges. An agent is available when any of its binaries is found by `IFileSystemPort.isInPath`. Availability is evaluated on every call and never cached, so installing an agent while the application runs makes it appear.

The catalog `agentId` equals the `agentName` of the created port, and it is what the orchestrator
uses to compare the live port with the chosen agent.

`AgentModule` exports the factory and the infrastructure ports `IProcessRunnerPort` and
`IFileSystemPort`. A singleton `IAgentPort` would make every conversation share the
same ACP session and the same `cwd`.

### Properties

- `agentName: string`: identifier of the concrete agent (`'agy'`, `'claude'`, `'copilot'`, `'codex'` or `'cursor'`), equal to the factory `agentId` and shown in the response footer.
- `lastAgentMessage: string`: last consolidated text response of the turn.
- `currentSessionId?: string`: ID of the active ACP session. It is `undefined` without a session, including after a lost transport or a forced cancellation.
- `supportsSteering: boolean`: whether the agent supports native steering while a turn is running.

### Methods

- `connect(): Promise<void>`: initializes the transport, reads the capabilities (`agentCapabilities.loadSession` and `_meta.steering.supported`) and discovers the configuration options. It is idempotent. If the handshake fails, the subprocess is terminated and the state cleared, allowing a retry. When the subprocess cannot be spawned because its binary does not exist (`ENOENT`), the error is `The <agent> agent CLI was not found in PATH (<spawn error>).`
- `createSession(cwd: string): Promise<void>`: creates a session (`session/new`) bound to the given directory.
- `loadSession(cwd: string, sessionId: string): Promise<boolean>`: resumes an existing session via `session/load`. Returns `false`, without throwing, when the agent does not advertise `loadSession` or when the load fails; returns `true` with `currentSessionId` set.
- `prompt(text: string): AsyncGenerator<AgentUpdate>`: sends a turn and delivers the consolidated final block.
- `sendSteeringPrompt(text: string): Promise<boolean>`: injects text into the running prompt. With steering, it sends `_session/steering` with `_meta.steering.idleBehavior = 'promptRequired'` and resolves `true` only with `outcome: 'injected'`; with no running prompt (`promptRequired`), no session or an error, it resolves `false` and the text is not delivered, so the caller decides what to do with it. Without steering, it fires `session/prompt` as a fallback and resolves `true`.
- `cancel(): Promise<void>`: interrupts the running prompt through the cancellation ladder. With no running prompt it is a no-op, so a late cancellation does not abort the next turn.
- `closeSession(): Promise<void>`: closes the active session, keeping the connection.
- `disconnect(): Promise<void>`: discards the session, terminates the subprocess and clears the cached options.
- `getAvailableModels(): AgentModelState | null`: published models and the active model.
- `getAvailableEffortsForModel(modelId: string): Promise<AgentEffortState | null>`: the model's effort levels, read in an isolated probe session.
- `setConfig(config: AgentConfig): Promise<void>`: applies model and/or effort to the active session and stores it as the preference for the next sessions.
- `getLastRoundUsage(): Promise<AgentUsage | undefined>`: token usage of the last turn or via fallback.
- `getQuota(): Promise<AgentQuota | undefined>`: the agent's usage limits (`groups` → `buckets` with `window`, `remainingFraction` from 0 to 1 and ISO `resetTime`). Resolves `undefined` when the agent does not expose a quota or the query fails; `AbstractAcpAdapter` returns `undefined` by default. `CopilotAdapter` runs `gh api /copilot_internal/user` (an undocumented internal endpoint, uses `gh` authentication) and converts it with `parseCopilotUserOutput` (`utils/copilot-usage.util.ts`): it ignores unlimited snapshots and maps the rest to `monthly` buckets. `AntigravityAdapter` runs `agy --output-format json --print /usage` via `IProcessRunnerPort.run` and converts the output with `parseAgyUsageOutput` (`utils/agy-usage.util.ts`).
- `onActivity(listener): () => void`: observes the live feed (thoughts, tools and cancellation).

### SDK-free Types

`AgentUpdate` is `{ kind: 'text'; text: string }` and `AgentToolStatus` is
`'pending' | 'in_progress' | 'completed' | 'failed'`. No type from
`@agentclientprotocol/sdk` appears in the port; the SDK is only imported in
`src/modules/agent/{adapters,bridges,demux,testing}`.

## Session Lifecycle

```text
connect() ──> loadSession(cwd, id) ──false──> createSession(cwd) ──> prompt(text) ──> closeSession() ──> disconnect()
                     │                                                 │      ▲
                     └──────────────────true───────────────────────────┘      └── cancel()
```

### Resuming with `session/load`

The SDK only builds `ActiveSession` for `session/new`. A loaded session uses
`ResumedSession` (`adapters/resumed-session.ts`), which implements the same `SessionHandle`
(`sessionId`, `prompt`, `nextUpdate`, `dispose`): it receives updates through the global
`session/update` handler and sends the prompt directly via `session/prompt`. The handle is only created after
the `session/load` response, which discards the history the agent replays before it.

After creating or loading the session, the adapter applies the returned `configOptions`, the
`sessionConfigPresets()` and the `setConfig` preference.

### Lost Transport

`connect()` registers `exit` and `error` on the subprocess. When either fires, the adapter
logs `agent_process_exited`, discards the session and the transport and clears `currentSessionId`; a
running prompt fails with a transport error. `disconnect()` removes these listeners
before terminating the process, so the shutdown itself is not treated as a crash. The
next `connect()` starts a new process.

### Cancellation Ladder

1. **Immediate notification**: sends `session/cancel` and opens a 5-second window.
2. **Escalation**: with steering, injects the abort prompt (`CANCEL_ABORT_PROMPT_TEXT`) via `_session/steering`; without steering, resends `session/cancel`, because a concurrent `session/prompt` would be rejected by the busy agent. Opens a 15-second window.
3. **Forced cancellation**: rejects the turn locally with `PromptCancelledError` and discards the session and the transport. The next turn reconnects and resumes the session with `loadSession`.

## Streaming Demux and Activities

`AgentStreamDemux` breaks raw ACP notifications down into typed events:

- `agent_thought_chunk`: `{ kind: 'thought', id, text }` activities.
- `tool_call` and `tool_call_update`: `{ kind: 'tool', toolCallId, title, status, details? }` activities. Tool details (arguments, execution parameters, output or errors) are extracted in full from the ACP payload without premature truncation.
- `agent_message_chunk`: narrated as a `thought` activity and accumulated; when `prompt()` closes it becomes the final `AgentUpdate` block. Empty responses produce no block.

The final response is the message that contains `<final_response>` (`constants/final-response.constant.ts`,
ignored in `agent_thought_chunk`). When this envelope appears, the message's feed entry is
closed with the prose preceding it (`final: true`) or removed (`removed: true`) when there is no prose,
and the message stops being narrated. `takeFinalText()` and `lastAgentMessage` return only the content of the
envelopes (`splitFinalResponse`), which accepts an unclosed envelope. Without an envelope, the final text
joins all non-thought messages, which covers sessions resumed from before the envelope.

## ACP Adapters

The `AbstractAcpAdapter` base class implements the ACP protocol, sessions and the integration
with the demux. It also provides `buildAgentEnv(cwd)`, the isolated environment of every agent
subprocess: credentials and configuration of the host application (`DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`,
`WORKSPACE_DIR`, `DATA_DIR`, `SESSION_IDLE_TIMEOUT_MS`, `PORT`), the variables that reveal the
application directory (`PWD`, `OLDPWD`, `INIT_CWD`, `PROJECT_CWD`) and those with the `npm_` prefix are
left out, and `PWD` is rewritten with the subprocess `cwd`. The rest of the environment is passed through, because the
agent depends on it to operate (`PATH`, `HOME`, `SSH_AUTH_SOCK`, the agent's own credentials).

An adapter's `sessionConfigPresets()` are applied to every created or loaded session, by
option category (`model`, `thought_level`, `mode`, `permissions`). A preset whose value the agent
does not publish is logged and ignored.

### `AntigravityAdapter`

`AntigravityAdapter` (`agentName = 'agy'`) extends `AbstractAcpAdapter` and provides:

- Resolution of the bridge binary (compiled `agy-acp-bridge.js` or `agy-acp-bridge.ts` in development).
- Execution of the bridge as a subprocess via `IProcessRunnerPort.spawn`, in `tmpdir()`, with `buildAgentEnv`. The bridge starts in `connect()`, before the session exists, so there is no session `cwd` to adopt.

The directory where the agent works is the session `cwd`, not the bridge's: `createSession(cwd)` and `loadSession(cwd, id)` receive the path, and the bridge starts each `agy` process in it, with `PWD` aligned.

The `agy-acp-bridge.ts` bridge advertises `loadSession: true`. `session/load` restarts `agy`
with `--conversation <sessionId>` and adopts that ID; the history is stored in agy itself and
is not replayed. If the `init` event carries a different `conversation_id`, agy opened a new
conversation: the bridge terminates the process and rejects `session/load`, and the orchestrator creates and persists
a new session. The bridge exposes only the `model` option (no `thought_level`).

Each `agy` process is a run (`AgyRun`) that holds its own pending prompt. The
`result`, `step_update` and `exit` events of a process only end that process's prompt. `session/cancel`
sends `SIGINT` and marks the run as interrupted; the next prompt starts a new process
with `--conversation`, even if the previous one has not exited yet, and the interrupted process
receives `SIGTERM`. This way, a late `exit` from the old process neither cancels nor rejects the new
prompt.

### `ClaudeCodeAdapter`

`ClaudeCodeAdapter` (`agentName = 'claude'`) integrates the Claude Code CLI through the official ACP adapter
`@agentclientprotocol/claude-agent-acp` (a project dependency), with no bridge of its own:

- Runs `node <claude-agent-acp>/dist/index.js`, resolved with `createRequire(import.meta.url)`, in `tmpdir()` and with `buildAgentEnv`.
- Sets `SLASH_COMMAND_TOOL_CHAR_BUDGET=100000` when the user has not set another value. It is the budget, in characters, of the skill listing Claude Code keeps in context; the default (1% of the window) truncates descriptions when the project has a few dozen skills.
- Sets `CLAUDE_CODE_EXECUTABLE` to the `claude` on the `PATH` (`IFileSystemPort.resolveInPath('claude')`), discarding any value inherited from the environment, so the Claude Agent SDK uses the CLI installed and authenticated by the user. Without `claude` on the `PATH`, the SDK uses the bundled binary.
- Session preset `mode = bypassPermissions`: nobody answers permission requests in a remote session. Claude Code does not offer this mode to a `root` process without `IS_SANDBOX=1`; in that case the session stays in the user's default mode and permission requests are approved by the `AbstractAcpAdapter` handler.
- The agent advertises `loadSession` and `_meta.steering.supported`, so resumption, steering (`_session/steering`) and the cancellation ladder with steering work without specific code. `session/load` replays the history before responding and restores neither model, effort nor mode; the base adapter's `applySessionConfig` reapplies them.
- The published options are `model` (aliases such as `opus`, `sonnet`, `haiku` and full IDs), `effort` (`thought_level` category, absent for models without effort, such as `haiku`), `mode` and `fast`. Efforts depend on the model and are read through the `getAvailableEffortsForModel` probe session.
- The session loads the user's Claude Code settings (`~/.claude/settings.json`, `CLAUDE.md`, hooks, skills), since the SDK runs with user, project and local `settingSources`.

### `CopilotAdapter`

`CopilotAdapter` (`agentName = 'copilot'`) integrates the GitHub Copilot CLI through the CLI's own native ACP
mode, with no bridge or extra dependency:

- Runs `copilot --acp --stdio` from the `PATH`, in `tmpdir()` and with `buildAgentEnv`. Authentication is the user's (`copilot login`).
- Sets `SKILL_CHAR_BUDGET=100000` when the user has not set another value: at the default of 15 thousand characters, skills that do not fit are listed by name only.
- Session preset `permissions = on`: the `allow_all` option turns on tool autonomy, and the agent runs tools without `session/request_permission`, which nobody would answer in a remote session.
- The agent advertises `loadSession`, but not `_meta.steering`: `sendSteeringPrompt` uses the `session/prompt` fallback and the cancellation ladder resends `session/cancel`.
- The published options are `mode` (`agent`, `plan`, `autopilot`, with URL IDs), `model` (models from several providers, including `auto`), `reasoning_effort` (`thought_level` category) and `allow_all` (`permissions` category).

### `CodexAdapter`

`CodexAdapter` (`agentName = 'codex'`) integrates OpenAI Codex through the
`@agentclientprotocol/codex-acp` bridge (a project dependency):

- Runs `node <codex-acp>/dist/index.js`, resolved with `createRequire(import.meta.url)`, in `tmpdir()` and with `buildAgentEnv`. The bridge ignores command-line arguments and reads its options from the environment.
- Sets `CODEX_PATH` to the `codex` on the `PATH` when the user has not set another; without it, the bridge uses the bundled `@openai/codex` binary, which may not match the host's architecture or libc. Authentication is the user's (`codex login`).
- `CODEX_CONFIG` receives `skills.max_context_tokens: 10000`, the ceiling Codex accepts for the skill listing (default of 2% of the window), merged under any JSON configuration the user already has in `CODEX_CONFIG`.
- Session preset `mode = agent-full-access`: the bridge applies approval and sandbox from the mode on each turn, so they do not come from the config. The `agent-full-access` mode never asks for approval and uses no sandbox.

### `CursorAdapter`

`CursorAdapter` (`agentName = 'cursor'`) integrates the Cursor CLI through its native ACP mode:

- Runs `cursor-agent` (or `agent`, the name in newer installations, when only it is on the `PATH`) with `--force --sandbox disabled --trust --approve-mcps acp`, in `tmpdir()` and with `buildAgentEnv`. The global flags come before the subcommand and turn off all interactive approval.
- Answers the blocking methods `cursor/ask_question` (`skipped`) and `cursor/create_plan` (`rejected`) with a message telling the agent to write the question (with the `<question>` tags of the question protocol) or the plan in the final response, so the turn is not left waiting.
- Cursor encodes the model parameters in the ID itself (`claude-opus-5[thinking=true,effort=high,fast=false]`) and publishes no effort option; `mapModel` carries the reasoning level and `fast` into the display name and lists the parameters in the description.

### ACP Versions

`@agentclientprotocol/claude-agent-acp` and `@agentclientprotocol/codex-acp` always move in mutually compatible versions: each bridge's `@agentclientprotocol/sdk` dependency resolves to the same SDK version declared by the project, leaving a single copy in the lockfile. When updating any of the three, check with `yarn why @agentclientprotocol/sdk`; if one bridge requires an SDK version outside the other's range, hold the update until both match.

## Prescriptive Rules

- **Do not instantiate adapters directly in use cases**: obtain instances via `@Inject(IAgentPortFactory)` and `create(agentId)`.
- **A new agent enters through the factory**: a new adapter extends `AbstractAcpAdapter`, uses `buildAgentEnv` when spawning and is registered in the `AcpAgentPortFactoryAdapter` catalog with an `agentId` equal to its `agentName` and the `binaries` that identify it in the `PATH`.
- **Offer only available agents**: consumers that present choices use `listAvailableAgents()`; `listAgents()` is the full catalog for resolving names.
- **Do not couple the core to the ACP SDK**: use cases handle only the types from `agent.port.ts`.
- **I/O isolation in concrete adapters**: file system and processes go through `IFileSystemPort` and `IProcessRunnerPort`.
- **Mandatory resource cleanup**: ensure `closeSession()` or `disconnect()` in `finally` blocks or when disposing of orchestration resources.
