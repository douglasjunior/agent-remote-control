# ACP Adapters

Every adapter extends `AbstractAcpAdapter`, spawns its CLI in `tmpdir()` with `buildAgentEnv` (the session directory is
the `cwd` of `createSession(cwd)` and `loadSession(cwd, id)`), and applies its `sessionConfigPresets()` to every
created or loaded session. Nobody answers a `session/request_permission` in a remote session: the adapters turn
interactive approval off where the CLI allows it, and the `AbstractAcpAdapter` handler approves any permission request
that still arrives, preferring `allow_always` over `allow_once`.

## `AntigravityAdapter` (`agentName = 'agy'`)

Integrates the Antigravity CLI through its native ACP server:

- Runs `agy acp --process-per-session --dangerously-skip-permissions` from the `PATH` through `IProcessRunnerPort.spawn`. Without `--process-per-session` the server keeps the `cwd` of the first session, which is the discovery session in `tmpdir()`, so every later session would work there.
- The agent advertises `loadSession` and `sessionCapabilities` (`resume`, `close`, `load`, `list`), and publishes the options `model`, `thought_level` and `mode`. A turn ends with `usage` in the `session/prompt` response; a cancel answers `stopReason: cancelled` and the next prompt works on the same session.
- `getQuota()` runs `agy --output-format json --print /usage` via `IProcessRunnerPort.run` and converts the output in a private method of the adapter.
- Without a login, `session/new` fails with JSON-RPC `-32000` `Authentication required`, which `AbstractAcpAdapter.buildTransportError` raises as `AgentAuthRequiredError`. A CLI missing from the `PATH` is raised as `AgentBinaryNotFoundError`. The orchestrator never retries either of them, since only a person fixes them.

## `ClaudeCodeAdapter` (`agentName = 'claude'`)

Integrates the Claude Code CLI through the official ACP adapter `@agentclientprotocol/claude-agent-acp` (a project
dependency), with no bridge of its own:

- Runs `node <claude-agent-acp>/dist/index.js`, resolved with `createRequire(import.meta.url)`.
- Sets `SLASH_COMMAND_TOOL_CHAR_BUDGET=100000` when the user has not set another value. It is the budget, in characters, of the skill listing Claude Code keeps in context; the default (1% of the window) truncates descriptions when the project has a few dozen skills.
- Sets `CLAUDE_CODE_EXECUTABLE` to the `claude` on the `PATH` (`IFileSystemPort.resolveInPath('claude')`), discarding any value inherited from the environment, so the Claude Agent SDK uses the CLI installed and authenticated by the user. Without `claude` on the `PATH`, the SDK uses the bundled binary.
- Session preset `mode = bypassPermissions`. Claude Code does not offer this mode to a `root` process without `IS_SANDBOX=1`; in that case the session stays in the user's default mode and permission requests are approved by the `AbstractAcpAdapter` handler.
- The agent advertises `loadSession` and `_meta.steering.supported`, so resumption, steering (`_session/steering`) and the cancellation ladder with steering work without specific code. `session/load` replays the history before responding and restores neither model, effort nor mode; the base adapter's `applySessionConfig` reapplies them.
- The published options are `model` (aliases such as `opus`, `sonnet`, `haiku` and full IDs), `effort` (`thought_level` category, absent for models without effort, such as `haiku`), `mode` and `fast`. Efforts depend on the model and are read through the `getAvailableEffortsForModel` probe session.
- The session loads the user's Claude Code settings (`~/.claude/settings.json`, `CLAUDE.md`, hooks, skills), since the SDK runs with user, project and local `settingSources`.
- `getQuota()` runs `claude -p /usage` via `IProcessRunnerPort.run` and converts the `<label>: <N>% used · resets <time> (<zone>)` lines in a private method of the adapter, mapping the session limit to `5h` and the weekly ones to `7d`.

## `CopilotAdapter` (`agentName = 'copilot'`)

Integrates the GitHub Copilot CLI through the CLI's own native ACP mode, with no bridge or extra dependency:

- Runs `copilot --acp --stdio` from the `PATH`. Authentication is the user's (`copilot login`).
- Sets `SKILL_CHAR_BUDGET=100000` when the user has not set another value: at the default of 15 thousand characters, skills that do not fit are listed by name only.
- Session preset `permissions = on`: the `allow_all` option turns on tool autonomy, and the agent runs tools without `session/request_permission`.
- The agent advertises `loadSession`, but not `_meta.steering`: `sendSteeringPrompt` uses the `session/prompt` fallback and the cancellation ladder resends `session/cancel`.
- The published options are `mode` (`agent`, `plan`, `autopilot`, with URL IDs), `model` (models from several providers, including `auto`), `reasoning_effort` (`thought_level` category) and `allow_all` (`permissions` category).
- `getQuota()` runs `gh api /copilot_internal/user` (an undocumented internal endpoint, uses `gh` authentication) and converts it in a private method of the adapter: it ignores unlimited snapshots and maps the rest to `monthly` buckets.

## `CodexAdapter` (`agentName = 'codex'`)

Integrates OpenAI Codex through the `@agentclientprotocol/codex-acp` bridge (a project dependency):

- Runs `node <codex-acp>/dist/index.js`, resolved with `createRequire(import.meta.url)`. The bridge ignores command-line arguments and reads its options from the environment.
- Sets `CODEX_PATH` to the `codex` on the `PATH` when the user has not set another; without it, the bridge uses the bundled `@openai/codex` binary, which may not match the host's architecture or libc. Authentication is the user's (`codex login`).
- `CODEX_CONFIG` receives `skills.max_context_tokens: 10000`, the ceiling Codex accepts for the skill listing (default of 2% of the window), merged under any JSON configuration the user already has in `CODEX_CONFIG`.
- Session preset `mode = agent-full-access`: the bridge applies approval and sandbox from the mode on each turn, so they do not come from the config. The `agent-full-access` mode never asks for approval and uses no sandbox.
- `getQuota()` spawns `codex app-server` (from `CODEX_PATH` or the PATH), performs the JSON-RPC `initialize`, `initialized` and `account/rateLimits/read` exchange within 10 s, kills the server and converts the `primary`/`secondary` windows in a private method of the adapter.
- **Known Codex behavior to recheck on every upgrade**: `session/load` resumes a thread on the model of the Codex config, not the one it recorded ([openai/codex#32061](https://github.com/openai/codex/issues/32061)), and Codex warns `This session was recorded with model X but is resuming with Y`. The warning arrives as a notice in the log. `applySessionConfig` restores the configured model before the first prompt, so no turn runs on the other model. With `codex-acp` 2.5.0, a CEO rollout had no model-switch instruction after its resumes and its prompt cache stayed intact. The Codex App Server documentation describes a one-time model-switch instruction for a resume on a different model, so compare `turn_context` and `token_count` in `~/.codex/sessions` after resuming: extra tokens there would justify starting Codex on the configured model through `CODEX_CONFIG`.

## `CursorAdapter` (`agentName = 'cursor'`)

Integrates the Cursor CLI through its native ACP mode:

- Runs `cursor-agent` (or `agent`, the name in newer installations, when only it is on the `PATH`) with `--force --sandbox disabled --trust --approve-mcps acp`. The global flags come before the subcommand and turn off all interactive approval.
- Answers the blocking methods `cursor/ask_question` (`skipped`) and `cursor/create_plan` (`rejected`) with a message telling the agent to write the question (with the `<question>` tags of the question protocol) or the plan in the final response, so the turn is not left waiting.
- Cursor encodes the model parameters in the ID itself (`claude-opus-5[thinking=true,effort=high,fast=false]`) and publishes no effort option; `mapModel` carries the reasoning level and `fast` into the display name and lists the parameters in the description.
- `getQuota()` posts to the Cursor API `DashboardService/GetCurrentPeriodUsage` (Connect JSON, `CURSOR_API_ENDPOINT` or `https://api2.cursor.sh`, 10 s timeout) with the access token the Cursor CLI stored at login, looked up like the CLI does: `CURSOR_AUTH_TOKEN`, then the macOS Keychain (`/usr/bin/security find-generic-password -a cursor-user -s cursor-access-token -w`) unless `AGENT_CLI_CREDENTIAL_STORE` is `file` or `memory`, then `auth.json` (`~/.cursor` on macOS with the `file` store, `XDG_CONFIG_HOME/cursor` on Linux, `APPDATA/Cursor` on Windows). An expired JWT is never sent and the token never reaches a log. The plan usage becomes the `Included usage`, `Auto` and `API` buckets of the billing cycle (`daily`, `weekly`, `monthly` or `cycle`, from the cycle's length).

## `OpenCodeAdapter` (`agentName = 'opencode'`)

Integrates the OpenCode CLI through its native ACP mode:

- Runs `opencode acp` from the `PATH`. It publishes the options `model` and `mode`.
- It has no quota: OpenCode bills through the configured model provider.
- It works without a login, with the free `opencode/*` models and with local models, so `IAgentAuthPort` does not cover it.
- The CLI starts a background service of its own (`opencode serve --service`, port `49374`) that outlives the ACP process. The adapter never stops it, and every `opencode` run must use the same `HOME`, because a service started under another `HOME` makes the next run fail with `Managed service port 49374 ... already in use`.
