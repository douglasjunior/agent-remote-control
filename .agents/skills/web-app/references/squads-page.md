# Squads page

A squad is a saved set of role profiles (agent, model, effort) applied to a conversation in one go. `/squads`,
`/squads/new` and `/squads/:squadId` render `SquadsPage`, which sends `squads.list` on every `open` (and `agents.list`
while no agents are known) and keeps the list of the last `squads`.

## Layout and navigation

- From 768 px the list and the squad sit side by side; below, the route shows one of them and the squad links back to
  the list ("All squads").
- There is no header link. The settings page links to it (a "Squads" card in its Squads tab) and so does the
  conversation settings sheet ("Manage squads"). Both carry `returnTo` in the router state (`squadsState`), the links
  within the page keep it, and the X ("Close squads") returns there, or to `/` for a page opened from its address.

## SquadList

The squads by name, each a `NavLink` with the name, a `Default` badge for the default squad, the description clamped to
two lines and the roles it sets (`SkillRoles` labelled "Sets"). "New squad" opens `/squads/new`. Without squads it says
how to start.

## SquadEditor

- Name, Description, the "Default for new conversations" switch (the server keeps one default and applies it to a
  conversation that starts without settings) and one row per role. The roles are those of a conversation the server
  described in a `profiles`, else `TEAM_ROLES`, plus any role the squad already sets (`squadRoles`).
- A role is in the squad or not: "Add" shows its `RoleEditor`, "Leave out" removes it ("Not in this squad: a
  conversation keeps its own setup for this role."). Applying the squad leaves the roles it does not set as they are.
- Saving ("Create squad", "Save squad") needs a name, at least one role and every role complete (`completeChoice`); it
  sends `squads.save` with the ids only and waits ("Saving…"). The next `squads` toasts "<name> saved" and opens a new
  squad found by its name; an `error` without `conversationId` shows inline in the editor it came from.
- The page holds one `useAgentOptions`, so the lists of models and efforts survive between squads.
- Delete (a trash `IconButton`) is confirmed in an `AlertDialog`; it sends `squads.delete` and the next `squads` toasts
  "<name> deleted" and returns to the list, or an `error` is toasted. Conversations that applied it keep their profiles.
- `/squads/new` reached through "Save as squad" starts from the conversation's profiles, carried as `draft` in the
  router state.

## RoleEditor and RoleForm

`components/settings/role-editor.tsx` is controlled: `value` (a `ProfileDraft`) and `onChange`, the three cascading
`OptionSelect`s (an agent clears model and effort, a model clears effort), asking for the lists of what is picked. It
sends nothing. `completeChoice` (`profile-choice.ts`) gives the `ProfileChoice` once it runs: a model when the agent
offers models, an effort when the model offers efforts. `RoleForm` wraps it for the settings sheet with Cancel and
Save; the squad editor uses `RoleEditor` per role.

## In the conversation settings sheet

- A "Squad" section at the top says where the roles come from ("Now: Squad <name>", "Squad <name> · customized" or
  "Custom", from `appliedSquad` and `customized` of the last `profiles`), with "Manage squads".
- "Apply squad" (asks `squads.list` whenever the sheet opens) sends `squads.apply` on pick; the roles update from the
  `profiles` broadcast, which toasts "Squad <name> applied". An `error` for the conversation shows in the section while
  no role editor is open.
- "Save as squad" opens `/squads/new` with the roles that have an agent.
- Per-role editing is unchanged: after applying a squad any role can still be changed, and the state turns customized.
