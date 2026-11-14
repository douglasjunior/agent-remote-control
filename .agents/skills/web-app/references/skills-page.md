# Skills page

`/skills` and `/skills/:skillName` render `SkillsPage`, which sends `skills.list` on every `open` and `skill.get` for the skill in the route, keeping each `skill.detail` it receives (`null` for an unknown name).

## Layout and navigation

- From 768 px the list and the skill sit side by side; below, the route shows one of them and the skill links back to the list.
- The header link carries `returnTo` (the page it was clicked on) in the router state (`skillsState`), the links within the page keep it, and the X ("Close skills") at the top of the list returns there, or to `/` for a page opened from its address.

## SkillList

`SkillList` filters by text (name or description) and by role (`ChoiceSelect` over the roles that read some skill), and groups the skills in "Custom" (the user's, first) and "Built-in". Beside the role filter, "New skill" calls `startConversation(CREATE_SKILL_PROMPT)`, opening a conversation with `Create a skill that ` in its composer for the user to finish. Each row is a `NavLink` with the name, the description clamped to two lines and `SkillRoles` (the agent color dot and label of each role).

## SkillDetail

- `SkillDetail` shows the name, a Custom or Built-in badge, the description, the roles with their `AgentMark` and the content as Markdown. The page lays out through a container query, since its width depends on the docked conversation list.
- A built-in skill is read-only.
- A custom one offers "Ask the CEO", which calls `startConversation(changeSkillPrompt(name))`: the conversation is created and opened with `Change the skill "<name>": ` in its composer for the user to finish.
- A custom skill also has Delete (a trash `IconButton` at the right of its name), confirmed in an `AlertDialog`: it sends `skill.delete`, and the matching `skill.result` returns to the list with a toast (or shows the error in a toast).
- Any `skill.deleted` makes the page ask for the list again, and for the open skill when it is the deleted one, since a built-in skill it replaced comes back.

## Starting a conversation with a prompt

`startConversation(prompt)` (in `ConversationsProvider`) keeps the prompt by request id and navigates with it in the router state; `ConversationPage` reads it once, hands it to `ConversationView` as `initialPrompt` (the composer's first text) and replaces the history entry without it, so a reload does not seed the composer again.
