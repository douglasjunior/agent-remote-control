# Settings commands

`WebSettingsService` serves the settings page over `GetSettingsUseCase`, `ChangeSettingsUseCase` (settings module),
`TestDiscordConnectionUseCase` (Discord module, which `WebModule` imports) and `IAgentConfigurationPort` for the user
language.

- `settings.get` answers the requester with `settings { settings }`: the user language first (`USER_LANGUAGE`, group
  `general`, kind `text`, source `saved` or `default`, default `English`; it lives with the preferences and has no
  environment variable, `envOnly: false`), then every catalog setting with `kind`, `group`, `apply`, `source`, `env`,
  `envOnly`, `value` and `defaultValue` (`options` for a `choice`). A secret carries only `value: { set }` and no default, never its value.
- `settings.set { requestId, changes }` takes the values by key, `USER_LANGUAGE` included. The language is checked with
  `userLanguageSchema` and every other value by `ChangeSettingsUseCase` against the catalog before anything is saved;
  then the settings are saved and the language stored (`setLanguage`). `settings.reset { requestId, keys }` removes the saved
  values (`resetLanguage` for `USER_LANGUAGE`).
- A change or a reset of an `envOnly` setting is refused
  (`X can only be set with its environment variable`). Each change answers its requester alone with `settings.result { requestId }`:
  `ok: false` with `error` when refused (`Unknown setting: X`, `X: <schema message>`), or `ok: true` once saved, after
  the `settings` broadcast to every connection, the requester included, so the requester holds the new values when it
  learns the save went through.
- `settings.discord.test { token?, guildId? }` answers the requester with `settings.discord.test.result`
  (`ok: true` with `botName` and `guildName?`, or `ok: false` with `error`). A blank `token` tests the saved one; an
  absent `guildId` tests the saved server and an empty one tests none.
- The three changing commands are logged by type only: `settings.set` and the test carry the bot token.
