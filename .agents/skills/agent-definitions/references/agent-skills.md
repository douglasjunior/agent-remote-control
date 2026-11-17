# Agent Skills

Every skill is an `AgentSkillDefinition` (`models/agent-skill-definition.model.ts`): `name`, `description`, the `roles`
that may read it, and `buildContent({ team, artifacts, workspaceDir })`, built when read with the team and the board
access of the reader and the workspaces root.

## Built-in skills

One `skills/<name>.skill.ts` constant each, named from `SKILL_NAMES` (`constants/skill-names.constant.ts`, where the
prompts and other skills take the names too), listed in `BUILT_IN_SKILLS` (`constants/built-in-skills.constant.ts`).

| Roles | Skills |
|---|---|
| CEO | `agent-team`, `artifact-board`, `delegation-protocol`, `response-protocol`, `workspace-navigation`, `skill-authoring` |
| Every executor (GIT_OPS, PRODUCT_OWNER, TECH_LEAD, DEVELOPER, CODE_REVIEWER, QA) | `board-requests` |
| CEO, PRODUCT_OWNER, TECH_LEAD, IT_SUPPORT | `asking-the-user` |
| QA | `running-the-app`, `web-ui-testing`, `api-testing`, `mobile-testing` |

### `asking-the-user`

The only guide to asking the user (`skills/asking-the-user.skill.ts`): when to ask, the grammar, options without
"Other", the recommended option first and marked `recommended` (assumed when the user does not reply within
`QUESTION_TIMEOUT_MS`), the text outside the tags as the context so each question stands on its own among several
agents, a `rationale` always filled, one independent question per item of a batch, and the `<user_answers>` format,
with `<attachment path="…"/>` for files the user attaches and `status="timed_out"` for an answer assumed because the
user was absent.

### `running-the-app` and `mobile-testing`

The QA prepares its own environment with them: `running-the-app` brings up local services with migrations and seeds,
points the application and its clients at them, rebuilding what reads a setting at build time, shapes the state a test needs in local data or, when data cannot reach it, in code, and undoes it
all at shutdown (tracked files reverted, `git status` as found, kept local data listed); `mobile-testing` adds how a
device reaches the host, with `adb reverse` for an Android emulator. Nothing either skill changes is ever committed.

## User skills

`FileUserSkillStoreAdapter` (bound to `IUserSkillStorePort`) reads `DATA_DIR/skills/<skill>/SKILL.md` on every call, so
edits apply without a restart.

- The frontmatter needs a `description` and `roles` (comma-separated, `[A, B]` or a `- A` list; folded `>` and `|`
  values are read); `name` defaults to the folder name. A skill without a description or roles is skipped with a warning.
- `write` creates or replaces one, atomically; `delete(name)` removes the folder of the skill of that name, whatever the
  folder is called.

## `AgentSkillsService` (`IAgentSkillsPort`)

- Merges both sources, a user skill replacing a built-in one of the same name (case-insensitive), roles included, and
  keeps for each role the skills whose `roles` name it (`list`, `read`).
- A role with `writesSkills` (the CEO) also reads any skill, lists them all with their roles (`listAll`) and writes user
  skills (`write`). A channel acting for the user uses `listAll` and `readAny` (built for the first role that reads the skill) to
  browse them, and `deleteUserSkill` to remove one for the user.
- `write` validates: a role that writes skills, lowercase kebab-case name up to 64 characters, not a built-in name,
  description up to 1024 characters, content up to 30000, and known roles, stored in their canonical form. A refusal
  comes back as `{ ok: false, error }` with the reason. The CEO learns how in its `skill-authoring` skill.
