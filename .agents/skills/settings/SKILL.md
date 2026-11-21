---
name: settings
description: >
  Runtime settings of the server: the settings module, SETTINGS_CATALOG (key, environment variable, zod schema,
  default, kind, group, live or restart), the precedence saved value > environment variable > default, the SQLite
  setting store, IRuntimeSettingsPort, ISettingsChangeNotifierPort, the config services that read through them, and how
  .env loads. Use when adding or reading a setting or environment variable, making a module react to a changed setting,
  or touching the settings commands.
---

# Settings

> **Maintaining this skill**
>
> Update this document whenever any rule described here changes: the catalog contract, the precedence, the store,
> the ports, the list of live and restart settings or the environment loading. A refactor that keeps the described
> behaviour leaves it alone.

`packages/server/src/modules/settings/` owns what the user changes from the web interface while the server runs.
Every module that reads a setting imports `SettingsModule`.

## Catalog

- `SETTING_SCHEMAS` (`@agent-remote-control/protocol/settings`) holds the zod schema of each setting's value, by the
  name of the environment variable it overrides; the server checks every change with it and the web form checks its
  fields with it, so both show the same messages.
- `SETTINGS_CATALOG` (`constants/settings-catalog.constant.ts`) completes each key with `env`, `defaultValue`, `kind`
  (`boolean`, `integer`, `text`, `choice` with `options`, `secret`), `group` (the section of the settings page:
  `general`, `discord`, `web`, `remote`, `agents`, `shell`, `turns`, `speech`), `apply` and, for some, `envOnly`. Its
  order is the page's within a tab; the web app picks the tab of each setting from its key or group.
- `apply: 'restart'` marks a value the server reads only as it starts: `STT_PROVIDER`, because `SpeechToTextModule`
  picks its adapter in a factory. Every other setting is `live`.
- `envOnly: true` marks a setting only its environment variable sets, because it widens what the server exposes or
  names a program to run: `SHELL_COMMAND_ENABLED`, `REMOTE_URL`, `WEB_ALLOWED_ORIGINS`, `STT_WHISPER_BIN` and
  `STT_FFMPEG_BIN`. `REMOTE_ENABLED` stays editable.
- Boot-only infrastructure stays out: `PORT`, `NODE_ENV`, `DATA_DIR` (it holds the database the settings live in),
  `WORKSPACE_DIR`, `WEB_ENABLED`, `WEB_STATIC_DIR`, `WEB_ACCESS_TOKEN`, and the CLIs' own variables (`CURSOR_*`,
  `CODEX_*`, `PATH`).
- A new setting is an entry in `SETTING_SCHEMAS` and in `SETTINGS_CATALOG`, a reader through `IRuntimeSettingsPort`,
  its label and description on the web settings page (it opens in the Advanced section unless `settings-sections.ts` places it
  elsewhere; an integer whose key ends in `_MS` is edited in minutes, or in seconds when its default is under a minute), and
  a row in the README and `.env.example`.

## Resolution

`IRuntimeSettingsPort` (`RuntimeSettingsService`): `get(key)` and `resolve(key)` (`{ value, source }`, source `saved`,
`env` or `default`).

- A saved value wins, then the environment variable, then the default. A saved value the schema rejects is logged once
  (`setting_invalid`) and skipped. An `envOnly` setting skips the saved values, so one already saved has no effect:
  the variable, then the default.
- A variable set to an empty text is a value for a `text` or `secret` (an empty `DISCORD_BOT_TOKEN` keeps the bot off);
  for the other kinds it reads as unset. Booleans read `true`/`false` in any case, integers digits only, choices in
  lower case. A variable that does not parse is logged once with its value, a secret's never, and skipped.
- `SettingsModule` loads the saved values in the factory of `RuntimeSettingsService`, so a provider built afterwards
  reads them, and every change replaces them in memory. A change made by another process on the same `DATA_DIR`
  applies here on restart.
- Read a setting where the value is used, never in a constructor or a field, so a saved change applies to the next
  use: the config services (`QuestionTimeoutConfigService`, `TurnRetryConfigService`, `DelegationLimitsConfigService`,
  `ShellCommandConfigService`, `AgentAuthConfigService`, `ArtifactLimitsConfigService`), `WhisperCppAdapter`,
  `ConversationRuntimeService` (each idle period), `WsClientTransportAdapter` (each upgrade), `FileConsoleLoggerAdapter`
  (each new day's file), `RemoteIdentityService` and `DiscordClientService`. Never read `process.env` for a catalog key.

## Changes

- `ChangeSettingsUseCase.execute({ values?, reset? })` checks every key against the catalog and every value against its
  schema, and saves the parsed values (`reset` removes saved values, so the variable or the default applies again) whole
  or not at all; it answers `{ ok: true }` or `{ ok: false, error }` (`Unknown setting: X`, `X: <schema message>`,
  `X cannot be changed and reset at once`, `X can only be set with its environment variable` for an `envOnly` key,
  whether changed or reset). It logs `[Settings Changed]` with the keys, never the values.
- `ISettingsStorePort` (`SqliteSettingsStoreAdapter`, table `setting`: key, value as JSON, `updated_at`): `load()` and
  `save(values, removed)`, one transaction that resolves to every saved setting.
- `ISettingsChangeNotifierPort`: `onChange(listener)` returns the unsubscribe function; `notify(keys)` calls each
  listener with the keys whose resolved value changed, after the change is in memory. A listener that throws or rejects
  is logged (`settings_listener_failed`) and the others still run. `DiscordClientService` restarts the bot on its
  connection settings and registers the slash commands again on the agent login flag;
  `RemoteClientTransportAdapter` restarts remote access on `REMOTE_ENABLED`. An `envOnly` setting never changes while
  the server runs, so no module listens to it.
- `GetSettingsUseCase` lists every setting with its value, source, default, kind, group, `apply`, `env` and `envOnly`; a secret shows
  only `{ set: boolean }`, so no channel can leak it.
- The web channel serves both through its `settings.*` commands and adds the user language, which lives with the
  preferences and has no environment variable.

## Environment loading

`loadEnvironment()` (`src/env-config.ts`, used by `AppModule` and `migrate-legacy.ts`) loads the root `.env` with
`ConfigModule.forRoot`, expanding `${VAR}` against a copy of `process.env`: `dotenv-expand` writes into the object it
expands against and treats an empty variable as unset, so expanding against `process.env` itself would let the file
replace a variable set empty. A variable already in the environment, empty included, wins over the file.

## Testing

- `testing/stub-runtime-settings.ts`: `StubRuntimeSettings` gives each setting its default unless the spec passes a value
  (fixed, or a function read on every use), and `set(key, value)`; values read as `saved`.
- `testing/fake-settings-store.ts`: `FakeSettingsStore` keeps the saved values in memory; `failNextSave` rejects once.
- A spec that compiles a module importing `SettingsModule` points `DATA_DIR` at a temporary directory with
  `useTemporaryDataDir()` (`test/temporary-data-dir.ts`) and closes the module.

## Checklist

- [ ] The key is in `SETTING_SCHEMAS` and `SETTINGS_CATALOG` with its default accepted by its schema.
- [ ] It is read through `IRuntimeSettingsPort` where it is used; `apply` says `restart` only when it cannot apply live.
- [ ] A module that holds state built from a setting listens to `ISettingsChangeNotifierPort` and unsubscribes on destroy.
- [ ] A setting that widens what the server exposes or names a program to run is `envOnly`.
- [ ] Secrets have `kind: 'secret'` and never reach a log or an event.
