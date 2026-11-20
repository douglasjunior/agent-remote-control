---
name: agent-port
description: >
  Integrates AI coding agent CLIs over the Agent Client Protocol (ACP) behind the IAgentPort
  port: session lifecycle and resumption, cancellation, streaming activities, the agent factory
  and the per-CLI adapters (Antigravity, Claude Code, Copilot, Codex, Cursor, OpenCode), plus
  the CLI login and login-state probes that authenticate them. Use when implementing, extending
  or consuming agents, ACP subprocesses, session/load, cancellation, quotas or agent login.
---

# Agent Port and ACP Integration

> **Maintaining this skill**
>
> Update this document whenever any rule described here changes. The criterion is not
> which rule — it is the nature of the change: the communication protocol, session
> lifecycle or agent contract changed → update; internal cosmetic adjustment that
> preserves the consolidated rules → leave it alone.

## Reference files

- [references/acp-adapters.md](references/acp-adapters.md): each per-CLI adapter — command line, environment
  variables, session presets, published options, steering and resumption support, quota source, MCP server support
  and known CLI behavior. Read it when changing, debugging or adding an adapter, when touching `getQuota()` of one
  agent, or before attaching an MCP server to a session.
- [references/cli-login.md](references/cli-login.md): `IAgentAuthPort` in full — status probes and login commands per
  agent, the Copilot pseudo-terminal, output parsing, code input, cancellation and timeouts. Read it when changing
  agent login or the login-state probes.

## `IAgentPort` Contract

The `IAgentPort` port lives in `packages/server/src/modules/agent/ports/agent.port.ts` and decouples
the application core from the technical details of communicating with AI agents.

Each `IAgentPort` instance represents one agent subprocess with a single ACP
session. Consumers obtain instances through the `IAgentPortFactory` factory
(`packages/server/src/modules/agent/ports/agent-port-factory.port.ts`), registered in `AgentModule` with
`AcpAgentPortFactoryAdapter`:

```ts
@Inject(IAgentPortFactory) private readonly agentPortFactory: IAgentPortFactory

const agentPort = this.agentPortFactory.create('claude');
```

The factory exposes:

- `defaultAgentId: string` (a getter): agent used while no choice is saved — `'agy'` when available, otherwise the first available agent, otherwise `'agy'`;
- `listAgents(): readonly AgentProviderInfo[]`: full catalog (`agentId`, `displayName`) in display order — `agy` (Antigravity), `claude` (Claude Code), `copilot` (GitHub Copilot), `codex` (OpenAI Codex), `cursor` (Cursor) and `opencode` (OpenCode);
- `listAvailableAgents(): readonly AgentProviderInfo[]`: the catalog entries whose CLI is visible in the `PATH`, in catalog order;
- `isAgentAvailable(agentId: string): boolean`: whether that agent's CLI is visible in the `PATH`; `false` for an unknown ID;
- `create(agentId: string): IAgentPort`: new agent instance, built regardless of the `PATH`; throws `Unknown agent "<id>". Available agents: ...` for an ID outside the catalog.

**PATH visibility**: each catalog entry declares the binaries that identify it — `agy` → `agy`, `claude` → `claude`, `copilot` → `copilot`, `codex` → `codex`, `cursor` → `cursor-agent` or `agent` (`CURSOR_BINARIES`), `opencode` → `opencode`. Claude Code and Codex also need their CLI in the `PATH`, although they run through bundled npm bridges. An agent is available when any of its binaries is found by `IFileSystemPort.isInPath`. Availability is evaluated on every call and never cached, so installing an agent while the application runs makes it appear.

The catalog `agentId` equals the `agentName` of the created port, and consumers compare the live port with the chosen
agent through it.

`AgentModule` exports the factory, `IAgentAuthPort` and the infrastructure ports `IProcessRunnerPort` and
`IFileSystemPort`. A singleton `IAgentPort` would make every conversation share the
same ACP session and the same `cwd`.

### Properties

- `agentName: string`: identifier of the concrete agent (`'agy'`, `'claude'`, `'copilot'`, `'codex'`, `'cursor'` or `'opencode'`), equal to the factory `agentId`.
- `lastAgentMessage: string`: the last message of the turn as the agent wrote it, protocol tags included.
- `currentSessionId?: string`: ID of the active ACP session. It is `undefined` without a session, including after a lost transport or a forced cancellation.
- `supportsSteering: boolean`: whether the agent takes text into a running prompt (`_meta.steering.supported` of `initialize`); `false` before `connect()`.
- `supportsHttpMcp: boolean`: whether the agent advertised Streamable HTTP MCP servers in `initialize` (`agentCapabilities.mcpCapabilities.http`); `false` before `connect()`.

### Methods

- `connect(): Promise<void>`: initializes the transport, reads the capabilities (`agentCapabilities.loadSession`, `agentCapabilities.mcpCapabilities.http` and `_meta.steering.supported`) and discovers the configuration options. It is idempotent. If the handshake fails, the subprocess is terminated and the state cleared, allowing a retry. When the subprocess cannot be spawned because its binary does not exist (`ENOENT`), the error is `The <agent> agent CLI was not found in PATH (<spawn error>).`
- `createSession(cwd: string, options?: AgentSessionOptions): Promise<void>`: creates a session (`session/new`) bound to the given directory, with the MCP servers of `options.mcpServers` (`AgentMcpServer`: `name`, `url` and `headers` of a Streamable HTTP server) as ACP `mcpServers` of type `http`. An agent without `supportsHttpMcp` gets none of them: the adapter leaves them out with a debug log, never throws.
- `loadSession(cwd: string, sessionId: string, options?: AgentSessionOptions): Promise<boolean>`: resumes an existing session via `session/load`, with `options.mcpServers` as `createSession` sends them. A new agent process knows none of the servers of the session it loads, so the caller sends them on every load. Returns `false`, without throwing, when the agent does not advertise `loadSession` or when the load fails; returns `true` with `currentSessionId` set.
- `prompt(text: string): AsyncGenerator<AgentUpdate>`: sends a turn and delivers the consolidated final block.
- `sendSteeringPrompt(text: string): Promise<SteeringOutcome>`: injects text into the running prompt with `_session/steering` and `_meta.steering.idleBehavior = 'promptRequired'`, so an idle agent stays idle. It resolves `injected` when the agent took the text, `not_running` when no prompt was running (the agent answered `promptRequired`, or there is no session), `unsupported` for an agent without steering (nothing is sent) and `failed` for an error or any other answer. Only `injected` delivers the text: on any other outcome the caller still holds it and decides what to do with it.
- `cancel(): Promise<void>`: interrupts the running prompt through the cancellation ladder. With no running prompt it is a no-op, so a late cancellation does not abort the next turn.
- `closeSession(): Promise<void>`: closes the active session, keeping the connection.
- `disconnect(): Promise<void>`: discards the session, terminates the subprocess and clears the cached options.
- `getAvailableModels(): AgentModelState | null`: published models and the active model. Grouped select options are flattened and each value listed once, the first occurrence kept, since some CLIs publish one value twice (Copilot's `auto`).
- `getAvailableEffortsForModel(modelId: string): Promise<AgentEffortState | null>`: the model's effort levels, read in an isolated probe session, which, like the discovery session of `connect()`, attaches no MCP server.
- `setConfig(config: AgentConfig): Promise<void>`: applies model and/or effort to the active session and stores it as the preference for the next sessions.
- `getLastRoundUsage(): Promise<AgentUsage | undefined>`: token usage of the last turn or via fallback.
- `getQuota(): Promise<AgentQuota | undefined>`: the agent's usage limits (`groups` → `buckets` with `window`, `remainingFraction` from 0 to 1 and ISO `resetTime`). Resolves `undefined` when the agent does not expose a quota or the query fails; `AbstractAcpAdapter` returns `undefined` by default. Each adapter that overrides it reads its CLI's or service's own usage source and converts it in a private method of the adapter (sources per agent in [references/acp-adapters.md](references/acp-adapters.md)); OpenCode has no quota.
- `onActivity(listener): () => void`: observes the live feed (thoughts, tools and cancellation).

### SDK-free Types

`AgentUpdate` is `{ kind: 'text'; text: string }` and `AgentToolStatus` is
`'pending' | 'in_progress' | 'completed' | 'failed'`. No type from
`@agentclientprotocol/sdk` appears in the port; the SDK is only imported in
`packages/server/src/modules/agent/{adapters,demux,testing}`.

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
2. **Escalation**: with steering, injects the abort prompt (`CANCEL_ABORT_PROMPT_TEXT`) via `_session/steering`, with no activity; without steering, resends `session/cancel`, because a concurrent `session/prompt` would be rejected by the busy agent. Opens a 15-second window.
3. **Forced cancellation**: rejects the turn locally with `PromptCancelledError` and discards the session and the transport. The next turn reconnects and resumes the session with `loadSession`.

## Agent Notices

`connect()` advertises `clientCapabilities.session.notices`, so agents send warnings as `session/update` records of type `notice` instead of message text. `AbstractAcpAdapter` logs them with `logger.warn` as `agent_notice (<severity>): <title>: <description>`; they stay out of activities and of `lastAgentMessage`.

## Streaming Demux and Activities

`AgentStreamDemux` breaks raw ACP notifications down into typed events:

- `agent_thought_chunk`: `{ kind: 'thought', id, text }` activities.
- `tool_call` and `tool_call_update`: `{ kind: 'tool', toolCallId, title, status, details? }` activities. Tool details (arguments, execution parameters, output or errors) are extracted in full from the ACP payload without premature truncation.
- `agent_message_chunk`: narrated as a `thought` activity (`text` whole at every change, `final: true` when the block closes because the agent went on to something else) and accumulated; when `prompt()` closes, the messages joined, one paragraph each, become the final `AgentUpdate` block. Empty responses produce no block. Reasoning chunks are `thought` activities with `reasoning: true` and stay out of the final text.

The demux tells thoughts from tool calls, keeps the messages in order and consolidates what the agent wrote. It
knows nothing of the response protocol: the text it hands over, in activities, `takeFinalText()` and
`lastAgentMessage`, is as the agent wrote it, `<final_response>` and other tags included, and reading the protocol is
the consumer's job.

The demux also keeps a trace of each prompt round (`StreamTrace`: message runs with their id, chunk count, characters and a short SHA-1 of the text, tool calls, and the first chunk shape of each message id), reset with the round by `reset()`. `AbstractAcpAdapter` logs it as `[Stream Trace]` and `[Stream Chunk Shapes]` when the round stops, from `describeTrace()` and `describeChunkShapes()`; the format is in the `logging` skill.

## ACP Adapters

The `AbstractAcpAdapter` base class implements the ACP protocol, sessions and the integration
with the demux. It also provides `buildAgentEnv(cwd)`, the isolated environment of every agent
subprocess: credentials and configuration of the host application (`DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`,
`WORKSPACE_DIR`, `DATA_DIR`, `SESSION_IDLE_TIMEOUT_MS`, `QUESTION_TIMEOUT_MS`, `PORT`), the variables that reveal the
application directory (`PWD`, `OLDPWD`, `INIT_CWD`, `PROJECT_CWD`) and those with the `npm_` prefix are
left out, and `PWD` is rewritten with the subprocess `cwd`. The rest of the environment is passed through, because the
agent depends on it to operate (`PATH`, `HOME`, `SSH_AUTH_SOCK`, the agent's own credentials).

An adapter's `sessionConfigPresets()` are applied to every created or loaded session, by
option category (`model`, `thought_level`, `mode`, `permissions`). A preset whose value the agent
does not publish is logged and ignored.

Every adapter spawns its CLI in `tmpdir()` with `buildAgentEnv`, and turns interactive approval off, since nobody
answers a permission request in a remote session. Per-CLI details: [references/acp-adapters.md](references/acp-adapters.md).

| Adapter | `agentName` | Runs | Quota source |
|---|---|---|---|
| `AntigravityAdapter` | `agy` | `agy acp --process-per-session --dangerously-skip-permissions` | `agy --output-format json --print /usage` |
| `ClaudeCodeAdapter` | `claude` | the `@agentclientprotocol/claude-agent-acp` adapter | `claude -p /usage` |
| `CopilotAdapter` | `copilot` | `copilot --acp --stdio` | `gh api /copilot_internal/user` |
| `CodexAdapter` | `codex` | the `@agentclientprotocol/codex-acp` bridge | `codex app-server` rate limits |
| `CursorAdapter` | `cursor` | `cursor-agent` (or `agent`) with approval flags and `acp` | Cursor dashboard API |
| `OpenCodeAdapter` | `opencode` | `opencode acp` | none |

### ACP Versions

`@agentclientprotocol/claude-agent-acp` and `@agentclientprotocol/codex-acp` always move in mutually compatible versions: each bridge's `@agentclientprotocol/sdk` dependency resolves to the same SDK version declared by the project, leaving a single copy in the lockfile. When updating any of the three, check with `pnpm why @agentclientprotocol/sdk`; if one bridge requires an SDK version outside the other's range, hold the update until both match.

## CLI Login (`IAgentAuthPort`)

`IAgentAuthPort` (`ports/agent-auth.port.ts`, implemented by `CliAgentAuthAdapter`) logs the agent CLIs in and reports
their login state for the channels, for the agents in `AGENT_AUTH_PROVIDERS`: `agy`, `claude`, `copilot`, `codex` and
`cursor` (OpenCode works without a login). `listAuthInfo()` / `getStatus(agentId)` report `authenticated`,
`unauthenticated` or `unknown` from a bounded status probe; `startLogin(agentId, listener)` spawns the CLI's login and
emits `url`, `prompt` and a final `completed`, `failed` or `cancelled`; `submitInput` and `cancelLogin` drive it.
Details per agent: [references/cli-login.md](references/cli-login.md).

- The link, the code and the pasted text are never logged; logs carry the agent id and the outcome only.
- `AGENT_AUTH_ENABLED=false` makes `isEnabled()` false, `listAuthInfo()` empty and `startLogin` throw.

## Prescriptive Rules

- **Do not instantiate adapters directly in use cases**: obtain instances via `@Inject(IAgentPortFactory)` and `create(agentId)`.
- **A new agent enters through the factory**: a new adapter extends `AbstractAcpAdapter`, uses `buildAgentEnv` when spawning and is registered in the `AcpAgentPortFactoryAdapter` catalog with an `agentId` equal to its `agentName` and the `binaries` that identify it in the `PATH`.
- **A new agent with a CLI login joins `AGENT_AUTH_PROVIDERS`** with its login arguments and a status probe verified against the installed CLI.
- **Offer only available agents**: consumers that present choices use `listAvailableAgents()`; `listAgents()` is the full catalog for resolving names.
- **Do not couple the core to the ACP SDK**: use cases handle only the types from `agent.port.ts`.
- **I/O isolation in concrete adapters**: file system and processes go through `IFileSystemPort` and `IProcessRunnerPort`.
- **Mandatory resource cleanup**: ensure `closeSession()` or `disconnect()` in `finally` blocks or when disposing of orchestration resources.
