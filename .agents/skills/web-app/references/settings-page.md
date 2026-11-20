# Settings page

`/settings` renders `SettingsPage` (`pages/settings-page.tsx`), which sends `settings.get` on every `open` and shows
the `settings` it receives. Its pieces live in `components/server-settings/`; `components/settings/` holds the agent
pickers of the conversation settings sheet and the squad editor, which are another thing.

## Layout and navigation

- The header link (a `Settings` gear icon link with a tooltip, beside the Skills link) carries `returnTo` in the router
  state (`settingsState`), and the X ("Close settings") returns there, or to `/` for a page opened from its address.
- Under the header, a "Squads" card links to `/squads` with `returnTo` (see [squads-page.md](squads-page.md)).
- One centered column (`max-w-3xl`), one `section` per group in the order its first setting arrives, titled from
  `GROUP_TITLES`; a group or a key the page does not know shows by its name, so a newer server still renders.
- Each `SettingField` is a `group` named by its label (`SETTING_TEXTS`): the label, a source badge (`Saved`,
  `Environment`, `Default`), `Unsaved` while changed, the variable name in mono (none for the language), the
  description, and for an `apply: 'restart'` setting "Applies when the server restarts.". The control sits beside the
  text from `sm` and below it on a phone.
- Controls by kind: `Switch` (boolean), `Input` with `inputMode="numeric"` and a unit hint (milliseconds with the
  duration, `off` for 0, days, characters) for an integer, `Input` for text, `ChoiceSelect` for a choice.
- A secret is write-only: `Set` or `Not set`, then "Set"/"Replace" opens a password field ("Cancel" closes it) and
  "Clear" saves it empty ("Cleared when you save", "Undo"). The saved value never reaches the browser.
- "Reset to default" shows only on a saved value and sends `settings.reset` at once; the value of the environment
  variable, or the default, applies again.

## Changing and saving

- Changes are drafts by key until "Save changes", in a bar below the page while any draft differs ("N unsaved
  changes", "Discard"). `checkDraft` checks each one as it is typed with `SETTING_SCHEMAS` (`userLanguageSchema` for the
  language), the schemas the server checks with, and shows the message under the field; an invalid draft disables
  saving. An integer must be digits.
- Saving sends one `settings.set` with every changed value and waits ("Saving…", fields disabled): the next `settings`
  drops the saved drafts, toasts "Settings saved" and, when a saved key applies on restart, shows the notice "Restart
  the server to apply <labels>." until the page closes; an `error` without `conversationId` shows its message in the
  bar and keeps the drafts. Every `settings` broadcast refreshes the values, keeping the drafts.
- The Discord section ends with "Test connection": it sends `settings.discord.test` with the token typed in the form
  (none, to test the saved one) and the server ID of the form, and shows "Connected as <bot> in <server>." or the
  error inline ("Testing…" meanwhile). Nothing is saved.
