# Settings hub

Every configuration screen is a section of one hub at `/settings`: General, Agents, Squads, Skills, Discord and
Advanced, in that order. The pieces live in `components/settings-hub/`; the squad and skill components they render
stay in `components/squads/` and `components/skills/`, the server settings fields in `components/server-settings/`,
the agent logins in `components/auth/`, and `components/settings/` holds the agent pickers of the conversation
settings sheet and the squad editor, which are another thing.

## Routes

| Route | Renders |
| --- | --- |
| `/settings` | the section list on a phone; on a wide screen it redirects to `/settings/general` |
| `/settings/general`, `/agents`, `/discord`, `/advanced` | `ServerSettingsSection` |
| `/settings/squads`, `/squads/new`, `/squads/:squadId` | `SquadsSection` |
| `/settings/skills`, `/skills/:skillName` | `SkillsSection` |

- The nested detail routes are children without an element of the section route, so one `SquadsSection` or
  `SkillsSection` stays mounted while the detail changes; the section reads `useParams` and `useMatch`.
- `MovedToHub` redirects the old addresses, keeping the rest of the path, the search and the router state: `/skills`,
  `/skills/:name`, `/squads`, `/squads/new` and `/squads/:id` go to the same path under `/settings`. A `/settings?tab=x`
  address goes to `/settings/x` (an unknown `x` to General), on a phone too.
- `settings-paths.ts` holds every path helper (`settingsPath`, `squadsPath`, `skillsPath`, `NEW_SQUAD_PATH`) and
  `settingsState`. `settings-sections.ts` holds `SETTINGS_SECTIONS` (id, label, one-line description, icon),
  `sectionOf` and `HUB_WIDE_QUERY`.

## Layout and navigation

- `SettingsHubLayout` is the layout route: a header (the h2 "Settings" and the X "Close settings"), `SettingsNav`, the
  section as an `<Outlet>` and, below, `SettingsSaveBar`. The X returns to `returnTo` of the router state, or to `/` for
  a hub opened from its address.
- The header gear (`/settings`) and every link into the hub carry `returnTo` in the router state; `settingsState` gives
  the state of a link: from outside the hub it is the page the link sits on (path and search), inside it keeps the
  `returnTo` it has. The conversation settings sheet ("Manage squads", "Save as squad") and the skill links of the feed use it too.
- From `HUB_WIDE_QUERY` (1024 px of viewport; `useMediaQuery` decides, so a spec makes the hub wide with
  `stubWideHub` from `test/wide-hub.ts`) the nav is a 14 rem column at the left of the section. Below it the hub shows
  one thing at a time: `/settings` is the list alone, each row with its icon, label, description and a chevron; a
  section opens full screen under a "Back" link to `/settings`; a detail route (a skill, a squad) has no hub Back, only
  the "Back" of its detail, which goes to its section list.
- The section sits in a `@container/hub` and every section starts with `SettingsSectionHeader` (h3 title, one line,
  optional primary action: "New squad", "New skill").
- Squads and Skills lay out through the hub container: from `@3xl/hub` (48 rem of content) the list and the detail are
  side by side (the detail pane shows "Pick a squad" or "Pick a skill" while none is open); below, the route shows one of
  them and the detail's "Back" (`@3xl/hub:hidden`) returns to the list. The detail pane is a container of its own for
  the layout of its content.
- `SettingsNav` marks the active section (`aria-current`), and a section holding an unsaved draft shows a dot
  (`bg-attention`), one holding an invalid draft a destructive dot, each with a screen-reader suffix in the link name
  ("Discord (has unsaved changes)", "(has an invalid value)").

## Server settings sections

`ServerSettingsProvider` (in the layout) sends `settings.get` on every `open` and keeps the `settings` it receives,
the drafts, the saving state and the Discord test above the sections, so a draft survives switching sections.
`useServerSettings` reads it; `ServerSettingsSection` shows the groups of its section.

- `sectionOf` places each setting: `KEY_SECTIONS` (`USER_LANGUAGE`), then `GROUP_SECTIONS` (`discord`, `agents`), and
  anything else, including a group a newer server adds, goes to `advanced`.
  - **General**: the language.
  - **Agents**: the logins of the agent CLIs (see [agent-logins.md](agent-logins.md)) as a "Logins" block above the
    "Agent login" group with its two timeouts.
  - **Discord**: the bot, its token and server, and "Test connection".
  - **Advanced**: allowed origins, remote access, session idle timeout, question timeout and log retention (the
    "Sessions and logs" group), shell commands, turn retry delays and delegation limits, speech-to-text.
- One centered column (`max-w-3xl`), one `section` per group in the order its first setting arrives, titled from
  `groupTitle` (`GROUP_TITLES`; the `general` group reads "Sessions and logs" in Advanced); a group or a key the app does
  not know shows by its name, so a newer server still renders. A closing line says a saved value takes the place of its
  environment variable. The loading status shows inside each section until the first `settings`.
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

### Changing and saving

- Changes are drafts by key until "Save changes", in `SettingsSaveBar` below the hub, whichever section is open, while
  any draft differs ("N unsaved changes", "Discard"). `checkDraft` checks each one as it is typed with `SETTING_SCHEMAS`
  (`userLanguageSchema` for the language), the schemas the server checks with, and shows the message under the field; an
  invalid draft disables saving. An integer must be digits, a duration a plain number (no sign, comma or exponent).
- Saving sends one `settings.set` with every changed value and a new `requestId`, and waits ("Saving…", fields
  disabled) for the `settings.result` of that `requestId`: `ok: true` drops the saved drafts, toasts "Settings saved"
  and, when a saved key applies on restart, shows the notice "Restart the server to apply <labels>." above the section
  until the hub closes; `ok: false` shows its `error` in the bar and keeps the drafts. A connection that leaves `open`
  before the answer ends the wait with "The connection closed before the server confirmed the change. Check the values
  and try again.", keeping the drafts. `settings.reset` waits the same way. Every `settings` broadcast refreshes the
  values, keeping the drafts.
- The Discord group ends with "Test connection": it sends `settings.discord.test` with the token typed in the form
  (none, to test the saved one) and the server ID of the form, and shows "Connected as <bot> in <server>." or the
  error inline ("Testing…" meanwhile). Nothing is saved.

## Squads section

A squad is a saved set of role profiles (agent, model, effort) applied to a conversation in one go. `SquadsSection`
sends `squads.list` on every `open` (and `agents.list` while no agents are known) and keeps the list of the last `squads`.
Its header has "New squad" (`/settings/squads/new`).

- `SquadList`: the squads by name, each a `NavLink` with the name, a `Default` badge for the default squad, the description
  clamped to two lines and the roles it sets (`SkillRoles` labelled "Sets"). Without squads it says how to start.
- `SquadEditor`: Name, Description, the "Default for new conversations" switch (the server keeps one default and applies
  it to a conversation that starts without settings) and one row per role. The roles are those of a conversation the
  server described in a `profiles`, else `TEAM_ROLES`, plus any role the squad already sets (`squadRoles`).
- A role is in the squad or not: "Add" shows its `RoleEditor`, "Leave out" removes it ("Not in this squad: a
  conversation keeps its own setup for this role."). Applying the squad leaves the roles it does not set as they are.
- Saving ("Create squad", "Save squad") needs a name, at least one role and every role complete (`completeChoice`); it
  sends `squads.save` with the ids only and waits ("Saving…"). The next `squads` toasts "<name> saved" and opens a new
  squad found by its name; an `error` without `conversationId` shows inline in the editor it came from.
- The section holds one `useAgentOptions`, so the lists of models and efforts survive between squads.
- Delete (a trash `IconButton`) is confirmed in an `AlertDialog`; it sends `squads.delete` and the next `squads` toasts
  "<name> deleted" and returns to the list, or an `error` is toasted. Conversations that applied it keep their profiles.
- `/settings/squads/new` reached through "Save as squad" starts from the conversation's profiles, carried as `draft`
  in the router state.

### RoleEditor and RoleForm

`components/settings/role-editor.tsx` is controlled: `value` (a `ProfileDraft`) and `onChange`, the three cascading
`OptionSelect`s (an agent clears model and effort, a model clears effort), asking for the lists of what is picked. It
sends nothing. `completeChoice` (`profile-choice.ts`) gives the `ProfileChoice` once it runs: a model when the agent
offers models, an effort when the model offers efforts. `RoleForm` wraps it for the settings sheet with Cancel and
Save; the squad editor uses `RoleEditor` per role.

### In the conversation settings sheet

- A "Squad" section at the top says where the roles come from ("Now: Squad <name>", "Squad <name> · customized" or
  "Custom", from `appliedSquad` and `customized` of the last `profiles`), with "Manage squads" (`/settings/squads`).
- "Apply squad" (asks `squads.list` whenever the sheet opens) sends `squads.apply` on pick; the roles update from the
  `profiles` broadcast, which toasts "Squad <name> applied". An `error` for the conversation shows in the section while
  no role editor is open.
- "Save as squad" opens `/settings/squads/new` with the roles that have an agent.
- After applying a squad any role can still be changed, and the state turns customized.

## Skills section

`SkillsSection` sends `skills.list` on every `open` and `skill.get` for the skill in the route, keeping each
`skill.detail` it receives (`null` for an unknown name). Its header has "New skill", which calls
`startConversation(CREATE_SKILL_PROMPT)`, opening a conversation with `Create a skill that ` in its composer for the
user to finish.

- `SkillList` filters by text (name or description) and by role (`ChoiceSelect` over the roles that read some skill), and
  groups the skills in "Custom" (the user's, first) and "Built-in". Each row is a `NavLink` with the name, the
  description clamped to two lines and `SkillRoles` (the agent color dot and label of each role).
- `SkillDetail` shows the name, a Custom or Built-in badge, the description, the roles with their `AgentMark` and the
  content as Markdown. A built-in skill is read-only. A custom one offers "Ask the CEO", which calls
  `startConversation(changeSkillPrompt(name))`: the conversation opens with `Change the skill "<name>": ` in its
  composer for the user to finish.
- A custom skill also has Delete (a trash `IconButton` at the right of its name), confirmed in an `AlertDialog`: it sends
  `skill.delete`, and the matching `skill.result` returns to the list with a toast (or shows the error in a toast).
- Any `skill.deleted` makes the section ask for the list again, and for the open skill when it is the deleted one, since a
  built-in skill it replaced comes back.
- `startConversation(prompt)` (in `ConversationsProvider`) keeps the prompt by request id and navigates with it in the
  router state; `ConversationPage` reads it once, hands it to `ConversationView` as `initialPrompt` (the composer's first
  text) and replaces the history entry without it, so a reload does not seed the composer again.
- The skill links of the feed (`ActivityGroup`) open `/settings/skills/:name`, and closing the hub returns to the conversation.
