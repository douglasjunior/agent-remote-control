# CLI Login (`IAgentAuthPort`)

`IAgentAuthPort` (`ports/agent-auth.port.ts`, implemented by `CliAgentAuthAdapter`, exported by `AgentModule`) logs the
agent CLIs in and reports their login state for the channels. It covers the agents in `AGENT_AUTH_PROVIDERS`
(`constants/agent-auth-providers.constant.ts`): `agy`, `claude`, `copilot`, `codex` and `cursor`.

## Login state

`listAuthInfo()` / `getStatus(agentId)` return `AgentAuthInfo` with status `authenticated`, `unauthenticated` or
`unknown` (a probe that failed or timed out). Every probe is bounded by `AGENT_AUTH_STATUS_TIMEOUT_MS`.

| Agent | Probe |
|---|---|
| `claude` | `claude auth status` (JSON; exit 1 when logged out) |
| `codex` | `codex login status` (exit 1 when logged out) |
| `cursor` | `cursor-agent status --format json` (read `isAuthenticated`; the exit code is 0 either way) |
| `agy`, `copilot` | no status command: the probe opens an ACP session and reads `AgentAuthRequiredError` as logged out |

## Running a login

`startLogin(agentId, listener)` spawns the login with piped stdio:

| Agent | Login command |
|---|---|
| `agy` | `agy acp --login` |
| `claude` | `claude auth login --claudeai` |
| `copilot` | `copilot login --device-code` (under a pseudo-terminal, see below) |
| `codex` | `codex login --device-auth` |
| `cursor` | `cursor-agent login` |

- **Copilot** (`login.terminal`) runs under `script -qfec` (a pseudo-terminal), because without one it fails with
  `Login succeeded, but the token was not saved` on a machine without a system keychain, while with one it asks whether
  a plain file may hold the token. The login answers that question itself with `y` (`login.confirmAnswer`): without a
  system keychain, as in WSL and containers, the plain file under `~/.copilot/` (mode `600`) is the only place the token
  can go, and the user cannot be expected to know the answer. Without `script` in the `PATH` the CLI runs directly.
- A yes or no question of a CLI without `confirmAnswer` reaches the user as a `prompt`.
- `LoginOutputParser` reads stdout and stderr and emits `url` (with `code` for device flows), `prompt` (Claude and
  Antigravity wait for a code pasted on stdin, and the prompt is emitted again whenever the CLI rejects a code) and, at
  the end, `completed`, `failed` or `cancelled`. A clean exit completes only when the status probe does not report
  `unauthenticated`.
- A second `startLogin` for the same agent joins the running login and receives the last link and prompt first.
- `submitInput(agentId, text)` writes a line to the login's stdin; Claude reports a wrong code and keeps waiting, while
  Antigravity ends the login with a `failed` event carrying its message.
- `cancelLogin(agentId)` sends `SIGTERM`, then `SIGKILL` after 3 s. A login stops by itself after
  `AGENT_AUTH_LOGIN_TIMEOUT_MS` (15 min) and when the module is destroyed.
- The login runs with `BROWSER` and `NO_OPEN_BROWSER` set and with a directory of no-op opener stand-ins (`xdg-open`,
  `wslview`, `explorer.exe`, ...) first in `PATH`: setting the variables is not enough to stop `agy` from opening a
  browser on the host.

## Rules

- The link, the code and the pasted text are never logged; logs carry the agent id and the outcome only.
- `AGENT_AUTH_ENABLED=false` makes `isEnabled()` false, `listAuthInfo()` empty and `startLogin` throw.
