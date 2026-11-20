# Settings page

`/settings` renders `SettingsPage` (`pages/settings-page.tsx`), which sends `settings.get` on every `open` and shows
the `settings` it receives. Its pieces live in `components/server-settings/`; `components/settings/` holds the agent
pickers of the conversation settings sheet and the squad editor, which are another thing.

## Layout and navigation

- The header link (a `Settings` gear icon link with a tooltip, beside the Skills link) carries `returnTo` in the router
  state (`settingsState`), and the X ("Close settings") returns there, or to `/` for a page opened from its address.
- Under the header, a tab list (`Tabs`, `components/ui/tabs.tsx`) splits the page; the open tab is the `tab` query
  parameter (`/settings?tab=advanced`; the default `general` leaves the address bare, an unknown value opens the default), set
  with a replacing navigation that keeps the router state, so a reload or a link opens the same tab and Close still
  returns to `returnTo`. The tab list scrolls horizontally on a phone (`overflow-x-auto` around a `w-max` list).
  `settings-tabs.ts` places each setting: `tabOf` reads `KEY_TABS` (`USER_LANGUAGE`), then `GROUP_TABS` (`discord`,
  `agents`), and sends anything else, including a group a newer server adds, to `advanced`.
  - **General**: the language.
  - **Discord**: the bot, its token and server, and "Test connection".
  - **Agents**: agent login and its two timeouts.
  - **Squads**: the "Squads" card linking to `/squads` with `returnTo` (the path and query, so closing the squads
    page comes back to this tab; see [squads-page.md](squads-page.md)).
  - **Advanced**: allowed origins, remote access, session idle timeout, question timeout and log retention (the
    "Sessions and logs" section), shell commands, turn retry delays and delegation limits, speech-to-text.
- Drafts, the save bar and the restart notice live above the tabs, so a change survives a tab switch and counts in
  "N unsaved changes". A tab holding an unsaved draft shows a dot (`bg-attention`), one holding an invalid draft a
  destructive dot, each with a screen-reader suffix in the tab name ("Discord (has unsaved changes)", "(has an invalid
  value)"). An inactive tab is not mounted; the loading status shows inside each tab until the first `settings`.
- One centered column (`max-w-3xl`), one `section` per group of the tab in the order its first setting arrives, titled
  from `groupTitle` (`GROUP_TITLES`; the `general` group reads "Sessions and logs" in Advanced); a group or a key the
  page does not know shows by its name, so a newer server still renders.
- Each `SettingField` is a `group` named by its label (`SETTING_TEXTS`): the label, a source badge (`Saved`,
  `Environment`, `Default`), `Unsaved` while changed, the variable name in mono (none for the language), the
  description, and for an `apply: 'restart'` setting "Applies when the server restarts.". The control sits beside the
  text from `sm` and below it on a phone.
- A setting with `envOnly` shows its value read-only (`Enabled`/`Disabled`, the text or `Not set`) in an `output`,
  with its source badge, no input and no reset. A `CircleHelp` button ("Where this value is set", reachable by keyboard)
  beside the label opens the tooltip "This value can only be set with the environment variable <NAME>." (`view.env`,
  the key when absent).
- Controls by kind: `Switch` (boolean), `Input` with `inputMode="numeric"` and a unit hint (days, characters) for an
  integer, `Input` for text, `ChoiceSelect` for a choice.
- A duration (an integer whose key ends in `_MS`) is edited in `minutes`, or in `seconds` when its default is under a
  minute (`timeUnitOf` in `setting-units.ts`, the only place that chooses: `AGENT_AUTH_STATUS_TIMEOUT_MS` and
  `TURN_RETRY_BASE_DELAY_MS` are seconds, every other `*_MS` is minutes). The `Input` has `inputMode="decimal"`, the unit
  beside it and takes decimals (`1.5`); a draft is that text, converted to whole milliseconds by `checkDraft`, and a
  field shows `toUnitText` of the value in use (up to six decimals, so a millisecond round-trips). A hint under the
  field says `off` for 0 and the minutes and seconds (`1m 30s`, `2h`) when the unit alone does not. A draft that stands
  for the same milliseconds is not a change (`5.0` for `5`). Messages speak in the unit ("Use a number of minutes, such
  as 1.5", "That is more minutes than can be saved"); the schema's "Use a number above 0" and "Use 0 or more" stay
  as they are. A read-only duration reads `1 minute`, `1.5 minutes`, `15 seconds`, `0 minutes · off`. Storage, the
  protocol and the environment variables stay in milliseconds.
- A secret is write-only: `Set` or `Not set`, then "Set"/"Replace" opens a password field ("Cancel" closes it) and
  "Clear" saves it empty ("Cleared when you save", "Undo"). The saved value never reaches the browser.
- "Reset to default" shows only on a saved value and sends `settings.reset` at once; the value of the environment
  variable, or the default, applies again.

## Changing and saving

- Changes are drafts by key until "Save changes", in a bar below the page while any draft differs ("N unsaved
  changes", "Discard"). `checkDraft` checks each one as it is typed with `SETTING_SCHEMAS` (`userLanguageSchema` for the
  language), the schemas the server checks with, and shows the message under the field; an invalid draft disables
  saving. An integer must be digits, a duration a plain number (no sign, comma or exponent).
- Saving sends one `settings.set` with every changed value and waits ("Saving…", fields disabled): the next `settings`
  drops the saved drafts, toasts "Settings saved" and, when a saved key applies on restart, shows the notice "Restart
  the server to apply <labels>." until the page closes; an `error` without `conversationId` shows its message in the
  bar and keeps the drafts. Every `settings` broadcast refreshes the values, keeping the drafts.
- The Discord section ends with "Test connection": it sends `settings.discord.test` with the token typed in the form
  (none, to test the saved one) and the server ID of the form, and shows "Connected as <bot> in <server>." or the
  error inline ("Testing…" meanwhile). Nothing is saved.
