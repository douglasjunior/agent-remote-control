# Agent Skills

Every skill is an `AgentSkillDefinition` (`models/agent-skill-definition.model.ts`): `name`, `description`, the `roles`
that may read it, and `buildContent(context)`, built when read from a `SkillContext`: the `team` and the `artifacts`
access of the reader, its `rolePrompt` (the role's full system prompt), the `agentInterface` of its session and the
`workspaceDir`. A passage that teaches a board or skill request has a variant per interface (the tags with their
grammar, the tools by bare name); the `<delegate>`, `<question>` and `<attachment>` grammar is the same on both, and a
description, shown in the catalog of both interfaces, names no request tag.

## Built-in skills

One `skills/<name>.skill.ts` constant each, named from `SKILL_NAMES` (`constants/skill-names.constant.ts`, where the
prompts and other skills take the names too), listed in `BUILT_IN_SKILLS` (`constants/built-in-skills.constant.ts`).

| Roles | Skills |
|---|---|
| CEO | `agent-team`, `artifact-board`, `delegation-protocol`, `response-protocol`, `workspace-navigation`, `skill-authoring` |
| Every executor (GIT_OPS, PRODUCT_OWNER, UX_DESIGNER, TECH_LEAD, DEVELOPER, CODE_REVIEWER, QA) | `board-requests` |
| Every executor and IT_SUPPORT | `role-guide` |
| CEO, PRODUCT_OWNER, UX_DESIGNER, TECH_LEAD, IT_SUPPORT | `asking-the-user` |
| DEVELOPER, GIT_OPS | `git-remote` |
| GIT_OPS | `repository-setup` |
| CODE_REVIEWER | `review-publishing` |
| DEVELOPER, CODE_REVIEWER, QA | `running-checks` |
| QA | `running-the-app`, `web-ui-testing`, `api-testing`, `mobile-testing` |
| UX_DESIGNER | `running-the-app` |

### `role-guide`

Returns `SkillContext.rolePrompt`, the full system prompt of the reader's role (`AgentSkillsService` builds it with
`getSystemPrompt(role, agentInterface)`, for the interface of the session reading it), for a session whose history
has lost it. A reader that browses skills for the user (`readAny`) gets the tags prompt of the first role the skill names.

### `asking-the-user`

The guide to asking the user in full (`skills/asking-the-user.skill.ts`); the essentials are inline in
`USER_QUESTIONS_BRIEF`. It covers when to ask, the grammar, options without "Other", the recommended option first and
marked `recommended` (assumed when the user does not reply in time) and worded so accepting it is an informed
decision, the text outside the tags as the context so each question stands on its own among several agents, a
`rationale` always filled, facts looked up before each round instead of asked, the decisions mapped as a tree whose
frontier (every decision whose prerequisites are settled) each round asks at once and which is updated after the
answers, the end of an interview (an empty frontier, nothing assumed, and a last round confirming the summary when the
role's instructions call for it), and the `<user_answers>` format, with `<attachment path="…"/>` for files the user
attaches and `status="timed_out"` for an answer assumed because the user was absent.

### `git-remote`, `repository-setup` and `review-publishing`

Procedures that touch a Git hosting provider, each for the roles that need it:

- `git-remote` (DEVELOPER, GIT_OPS): finding the provider with `git remote -v` and using its MCP tools, then its
  official CLI, with no `curl` or raw REST fallback; pushing only the given branch; one pull request per task, titled
  with the task id and title, described from the task and recorded on it (`<pull_request …/>` on the tags interface, the `pull_requests` of `artifact_update` on the tools); merging only on an
  instruction, with checks green, and recording `state="merged"`; authentication failures reported with the exact error.
- `repository-setup` (GIT_OPS): the workspace manifest (`WORKSPACE_MANIFEST_FILE`, a JSON array of
  `{ url, folder, defaultBranch }`, GIT_OPS its only writer), folder naming from the URL, choosing the transport, cloning,
  SSH key setup (an existing key is never overwritten and the private key never printed) and initializing a new repository.
- `review-publishing` (CODE_REVIEWER): the provider tooling, reading the pull request and its checks, publishing each
  finding inline on the new line or in the main discussion, submitting the verdict, and resolving the threads of fixed
  findings on a later review.

### `running-checks`

How to run each check for one file and for one package, read when the agent does not know it for the ecosystem at
hand: non-interactive runs through the project's scripts, the required checks read from the CI workflows (jobs on
`pull_request`, their `run:` steps, working directory, matrix and `paths` filters), the package of a file from its
nearest manifest and the workspace declarations, and the commands of Node (pnpm, npm, yarn; vitest, jest, rstest,
mocha; eslint, biome, prettier; tsc, vue-tsc), turbo, nx, lerna, Python (uv, poetry; pytest, ruff, mypy), Go, Rust
(cargo workspaces), JVM (Gradle and Maven per module) and .NET. The DEVELOPER's `### Checks` section names it.

### `running-the-app` and `mobile-testing`

The QA prepares its own environment with them, and UX_DESIGNER reads `running-the-app` to run the app it designs for and its prototype: `running-the-app` brings up local services with migrations and seeds,
points the application and its clients at them, rebuilding what reads a setting at build time, shapes the state a test
needs in local data or, when data cannot reach it, in code, and undoes it all at shutdown (tracked files reverted,
`git status` as found, kept local data listed); `mobile-testing` adds how a device reaches the host, with `adb reverse`
for an Android emulator. Nothing either skill changes is ever committed.

### `skill-authoring`

The CEO's guide to writing skills. A skill about how the team works (branching, pull requests, review and test gates)
names every role it governs in `roles`, the CEO included, with a section per role, so that each agent reads its own part
and the CEO's specifications name the skill without retelling it.

## User skills

`FileUserSkillStoreAdapter` (bound to `IUserSkillStorePort`) reads `DATA_DIR/skills/<skill>/SKILL.md` on every call, so
edits apply without a restart.

- The frontmatter needs a `description` and `roles` (comma-separated, `[A, B]` or a `- A` list; folded `>` and `|`
  values are read); `name` defaults to the folder name. A skill without a description or roles is skipped with a warning.
- `write` creates or replaces one, atomically, and tells whether it was created; `delete(name)` removes the folder of
  the skill of that name, whatever the folder is called. Both hold the lock `DATA_DIR/skills/.lock` (`storage` module),
  the delete from finding the skill to removing it, so concurrent writes report one creation.

## `AgentSkillsService` (`IAgentSkillsPort`)

- Merges both sources, a user skill replacing a built-in one of the same name (case-insensitive), roles included, and
  keeps for each role the skills whose `roles` name it (`list`, and `read(role, name, agentInterface)`, built for the
  interface of the reader's session).
- A role with `writesSkills` (the CEO) also reads any skill, lists them all with their roles (`listAll`) and writes user
  skills (`write`). A channel acting for the user uses `listAll` and `readAny` (built for the first role that reads the skill) to
  browse them, and `deleteUserSkill` to remove one for the user.
- `write` validates: a role that writes skills, lowercase kebab-case name up to 64 characters, not a built-in name,
  description up to 1024 characters, content up to 30000, and known roles, stored in their canonical form. A refusal
  comes back as `{ ok: false, error }` with the reason. The CEO learns how in its `skill-authoring` skill.
