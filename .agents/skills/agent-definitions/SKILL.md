---
name: agent-definitions
description: >
  Standard for defining, parameterizing and registering AI agent personas in the system.
  Governs the AgentRole roles (CEO, GIT_OPS, DEVELOPER, CODE_REVIEWER, TECH_LEAD, PRODUCT_OWNER and QA), the
  AgentDefinition contract with its delegation contract, the AgentRegistryService implementation (IAgentRegistryPort),
  the specialized system prompts, the skills agents read on demand (built-in and the user's own in DATA_DIR/skills),
  the instructions for asking the user questions, the CEO's lean core prompt and task routing. Use when creating,
  modifying or looking up agent personas, roles or agent skills.
---

# AI Agent Definition and Registration

> **Maintaining this skill**
>
> Update this document whenever any rule described here changes. The criterion is not
> which rule — it is the nature of the change: a role guideline, registration convention
> or persona structure changed → update; a technical refactor that preserves the described
> pattern → leave it alone.

The `AgentDefinitionsModule` lives in `packages/server/src/modules/agent-definitions/` and centralizes
the catalog of personas, specialized system prompts and model parameters for the system's
development agents.

## Agent Modeling

### Functional Roles (`AgentRole`)

The `AgentRole` type defines the canonical agent roles:

```typescript
export type AgentRole =
  | 'CEO'
  | 'GIT_OPS'
  | 'DEVELOPER'
  | 'CODE_REVIEWER'
  | 'TECH_LEAD'
  | 'PRODUCT_OWNER'
  | 'QA';
```

- **`CEO`**: Leader of the agent team. Talks to the user, triages, delegates all hands-on work to the other agents and reviews the results.
- **`PRODUCT_OWNER`**: Runs product discovery before any technical planning — requirements, business rules, exploration of ideas and features, flows, usability and acceptance criteria. Interviews the user directly, in rounds, and consolidates the intent on the board: a feature broken into tasks, with their business sections.
- **`TECH_LEAD`**: Specialist in technical planning, architectural exploration and impact assessment: writes the technical solution of each task on the board and splits large work into dependent tasks. Asks the user about every critical decision and design trade-off, with a justified recommendation.
- **`GIT_OPS`**: Owner of standalone Git operations that reach a remote — clone, init, fetch, pull, push, merge and rebase against remote branches, remote configuration, pull requests and SSH key setup. Maintains `workspace-manifest.json` at the workspaces root as a mapping from repository URL to project folder, and is its only writer (the CEO reads it to locate repositories). Does not run project scripts, even when they clone or fetch internally.
- **`DEVELOPER`**: Autonomous senior software engineer, agnostic to specific stacks or architectures, focused on adapting to the target project's architecture, code implementation and automated tests. In Git it operates only on the local side: working tree inspection, local branches and committing its own work. Runs the commands the project documents (`package.json` scripts, Makefile targets, setup or init scripts from README/AGENTS.md), even when they install dependencies or clone sub-repositories.
- **`CODE_REVIEWER`**: Critical, independent reviewer of the pull request linked on a task, free of bias from previous implementations. Never runs the project: it reads the results of the pull request pipeline, publishes its findings on the pull request and answers APPROVED or CHANGES_REQUESTED.
- **`QA`**: Tests the work on a task in practice after its review: runs the application from the task's branch and exercises its acceptance criteria and test cases as a user or client would (Playwright for web interfaces and HTTP APIs, mobile-mcp for mobile apps), records the test report and answers PASSED or FAILED. Never changes code or commits.

### Definition Contract (`AgentDefinition`)

Each agent is described by the `AgentDefinition` structure:

- `role`: the agent's role, restricted to the `AgentRole` union;
- `name`: human-readable label for the agent;
- `description`: descriptive summary of specialty and purpose;
- `buildSystemPrompt(team)`: builds the agent's prompt. Receives `team`, the other registered definitions, so that delegating agents can list their team. Executor agents ignore the parameter;
- `defaultModel`: optional default language model associated with the persona;
- `defaultSessionMode`: default session mode (`'resume' | 'new'`, default `'resume'`). When `'new'`, the orchestrator always starts a new ACP session for the agent;
- `delegation`: the agent's delegation contract (`AgentDelegationContract`), declaring which `<delegate>` attributes it accepts. `project` is `'required'` or `'optional'`; when absent, the agent receives no project folder. `sessionMode` is `'overridable'`; when absent, the mode is fixed to `defaultSessionMode` and passing the `session` attribute is rejected. `readOnly: true` declares that the agent never modifies the project, so it can run in parallel with an agent that modifies the same folder; when absent, the agent counts as a writer, and the orchestrator admits only one writer per folder at a time. PRODUCT_OWNER, TECH_LEAD and CODE_REVIEWER are `readOnly`; QA is a writer, since it switches branches and runs the project. `artifact` is `'required'` (DEVELOPER, CODE_REVIEWER, QA) or `'optional'` (PRODUCT_OWNER, TECH_LEAD, GIT_OPS); when absent, the agent takes no artifact. `needsReviewableWork: true` (CODE_REVIEWER, QA) requires the delegated artifact to link a pull request or record a branch. The set is specific to each agent, and a new parameter is added here;
- `artifacts`: the agent's `ArtifactAccess` to the board of its conversation (`constants/artifact-access.constant.ts`): `scope` (`board` for the CEO, `tree` for PRODUCT_OWNER and TECH_LEAD, `task` for DEVELOPER, GIT_OPS, CODE_REVIEWER and QA), `create`, the writable `sections` and the writable `fields`. The orchestrator enforces it on every artifact request, and `buildArtifactProtocolInstructions(access)` turns it into the agent's grammar;
- `writesSkills`: when `true` (the CEO), the role lists every skill, reads any of them and writes the user's skills (see "Skills on demand");
- `turnReminder`: optional turn reminder (`string`) appended to the prompt of each of the agent's rounds;
- `systemPromptEveryTurn`: when `true`, the orchestrator prefixes the system prompt to every user message, including in a resumed session; delegation result rounds and repair prompts for the same message do not repeat it. It serves long-session agents, whose context is compacted and loses the prompt sent at session creation; such an agent does without `turnReminder`.

### Where an instruction lives

Every instruction sits in one of four layers, chosen so that context stays small and the information is there when
the agent needs it:

1. **Core** (the system prompt): only what the role uses in nearly every task, kept short. The executors get it once
   per session; the CEO with every user message, so its core is the most expensive and the leanest.
2. **Turn reminder** (`turnReminder`, every round): the rules that must not fail and the skills to read again. It is
   what survives when a long session is compacted and the system prompt is gone.
3. **Skills** (read on demand): full grammars, guides and edge cases, always available on the server, listed by the
   `[SKILLS]` catalog and named by the reminder.
4. **Server validation**: every request and delegation is checked; an error comes back with its reason (and, for a
   failed request, a pointer to the skills), so an agent that forgot a detail gets it back instead of failing silently.

### The board (`artifact-protocol.prompt.ts`)

Every agent writes its deliverable to the board of the conversation, never to a document. From the role's `ArtifactAccess`:

- `buildArtifactProtocolInstructions(access)` writes the full protocol: the model of the board (features over tasks, one project per feature and its tasks, statuses, refinements, sibling dependencies, sections), the request grammar the role may use (list, read, `tree="true"` for `tree`, create when `create`, update with only its sections and fields, comment) and its rules: the results come back as `<request_results>`, the final answer comes in a response without requests; a `task` agent reads tasks and changes only the task it holds (`[DELEGATED_ARTIFACT]`); an artifact another agent holds is not changed.
- `buildArtifactProtocolBrief(access)` writes the board in brief: what it holds, the round trip, the requests the role uses in most tasks (read, update with its own fields and first section, create when allowed, comment), what it writes, its scope, and the `board-requests` skill for everything else.
- `buildArtifactProtocolReminder(access)` is the reminder line, which also names the `board-requests` skill.

The agents that work on one task (DEVELOPER, CODE_REVIEWER, QA, GIT_OPS) get the brief in their system prompt; PRODUCT_OWNER and TECH_LEAD, whose deliverable is the board in every task, get the full protocol. The `board-requests` skill (`skills/board-requests.skill.ts`, for every executor role) holds the full protocol built for the reader's access, to read again whenever it is out of view. The CEO gets the grammar and the routing in its `artifact-board` skill.

### Executor agents' CWD boundary

Every executor agent includes `CWD_BOUNDARY_INSTRUCTIONS` in its system prompt and `CWD_BOUNDARY_REMINDER`
in its `turnReminder` (`prompts/cwd-boundary.prompt.ts`). The agent does not read, list or change anything outside
the CWD unless the received prompt authorizes that exact path and mode (read or write).
When it needs something from outside, such as an SDK installed on the machine, it stops and returns in its final
response an access request with path, reason and mode. The CEO evaluates it, asks the user for confirmation when the
path leaves the workspace, and authorizes it by delegating again to the same role with `session="resume"`. The
access request is the response to the caller, never a direct question to the user, so that the CEO can
assess the risk first. GIT_OPS has `$HOME/.ssh` authorized in its own prompt for SSH key
setup.

### Skills on demand

Know-how an agent needs only for some tasks lives in skills instead of its system prompt. The orchestrator sends the
catalog (`[SKILLS]`, the name and description of each skill the role may read, the same explanation for every role and
an extra paragraph on managing skills for a role with `writesSkills`) with the system prompt, and the agent
reads a skill's full content with `<skill_read name="a,b"/>` in its final response when the task calls for it (grammar
and results in the `orchestrator` skill). The description is all the agent sees before reading, so it says what the
skill covers and when to read it.

Every skill is an `AgentSkillDefinition` (`models/agent-skill-definition.model.ts`): `name`, `description`, the `roles`
that may read it, and `buildContent({ team, artifacts, workspaceDir })`, built when read with the team and the board access of the reader and the
workspaces root.

- **Built-in skills**: one `skills/<name>.skill.ts` constant each, listed in `BUILT_IN_SKILLS`
  (`constants/built-in-skills.constant.ts`). The CEO's (`roles: ['CEO']`): `agent-team`, `artifact-board`,
  `delegation-protocol`, `response-protocol`, `workspace-navigation` and `skill-authoring`; every executor's:
  `board-requests`; QA's: `running-the-app`,
  `web-ui-testing`, `api-testing` and `mobile-testing`.
- **User skills**: `FileUserSkillStoreAdapter` (bound to `IUserSkillStorePort`) reads `DATA_DIR/skills/<skill>/SKILL.md`
  on every call, so edits apply without a restart. The frontmatter needs a `description` and `roles` (comma-separated,
  `[A, B]` or a `- A` list; folded `>` and `|` values are read); `name` defaults to the folder name. A skill without a
  description or roles is skipped with a warning. `write` creates or replaces one, atomically; `delete(name)` removes the folder
  of the skill of that name, whatever the folder is called.
- `AgentSkillsService` (bound to `IAgentSkillsPort`) merges both, a user skill replacing a built-in one of the same
  name (case-insensitive), roles included, and keeps for each role the skills whose `roles` name it. A role with
  `writesSkills` (the CEO) also reads any skill, lists them all with their roles (`listAll`, also used by the web, with `readAny`, to browse them) and writes user skills
  (`write`), which the service validates: lowercase kebab-case name up to 64 characters, not a built-in name,
  description up to 1024 characters, content up to 30000, and known roles, stored in their canonical form. The CEO
  learns how in its `skill-authoring` skill.

### Project orientation

DEVELOPER, TECH_LEAD, CODE_REVIEWER, QA and PRODUCT_OWNER include `PROJECT_ORIENTATION_INSTRUCTIONS` in their
system prompt and `PROJECT_ORIENTATION_REMINDER` in their `turnReminder` (`prompts/project-orientation.prompt.ts`).
Before its first action in the project during the session, the agent does a quick survey of what the project
documents for agents and contributors (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`,
`.github/instructions/*.instructions.md`, `README.md`, `CONTRIBUTING.md` and the nested `AGENTS.md` files in the
folders it will touch) and follows their pointers only where they cover the task.

The survey belongs to the agent itself, not the CEO: the executor's system prompt goes in at ACP session
creation, so the reading happens once per session and a resumed session already has it; the CEO, with its
prompt sent every turn and its CWD at the workspaces root, would pay for that context every turn and
pass on a lossy summary of the literal rules. Each ACP runtime natively loads a
different file (CLAUDE.md, AGENTS.md, Copilot instructions), and the explicit instruction covers the
rest. GIT_OPS does not receive the block: it does not work on the code and also runs at the workspaces root.

### Questions to the user

Any agent asks the user directly when it needs a decision from them to proceed, with
`<question rationale="…">text<option>…</option></question>` tags in its final response (grammar and queue
in the `orchestrator` skill). The instructions live in `prompts/user-questions.prompt.ts`:

- `USER_QUESTIONS_GUIDE`: the body of the rules — when to ask, one independent question per item
  in the batch, options without "Other", the recommended option first and marked `<option recommended>` (assumed when the user does not reply within `QUESTION_TIMEOUT_MS`), the text outside the tags as the context (task, findings, why blocked) so each question stands on its own among several agents, a `rationale` always filled with the impact of the answer, and the `<user_answers>` format, including
  `<attachment path="…"/>` for files the user attaches to the answer and `status="timed_out"` for an answer assumed because the user was absent;
- `USER_QUESTIONS_INSTRUCTIONS`: the guide under the `### Asking the User` heading, in the system prompt of
  PRODUCT_OWNER and TECH_LEAD, for whom asking the user is part of every task;
- `USER_QUESTIONS_BRIEF`: the grammar in brief and the `asking-the-user` skill, in the system prompt of DEVELOPER and
  GIT_OPS, which ask now and then; the skill (`skills/asking-the-user.skill.ts`, for the four roles) holds the guide;
- `USER_QUESTIONS_REMINDER`: the line included in the `turnReminder` of those four agents, which also names the skill.

CODE_REVIEWER and QA do not receive the instructions: they audit or test and return findings, with no user
decision they depend on to finish.

The CEO does not receive `USER_QUESTIONS_INSTRUCTIONS` (see "CEO's lean core prompt"): the core prompt
carries only the tag's shape and the fact that the answer comes back in the same turn, and the full guide lives in the
`response-protocol` skill, under `## Questions to the User`.

### CEO's lean core prompt

The CEO has no primer: with `systemPromptEveryTurn`, the core prompt accompanies every user
message to survive session compaction. Every line of it costs on every turn and dilutes the
rules that matter, so it carries only the hard rules whose loss breaks the protocol:
pure orchestration, answering every request the user made (a newer message never replaces an earlier request and every `<agent_result>` is reported), the workspace and its boundaries, the conversation style, the team with the `<delegate>` forms of each role, the board in brief (list it first, delegate with `artifact`, own the statuses), the three response outcomes (delegate, ask, answer) with the shape of
each tag, parallel work across roles, that agents ask the user directly, the user's confirmation for access outside the workspaces root, and attachments in an answer. The project folder rules, `session`, parallel limits, access requests, what each agent does, the request grammar and the routing of each status live in its skills (`delegation-protocol`, `response-protocol`, `agent-team`, `artifact-board`), which the core names, and the orchestrator's validation sends a repair when a delegation breaks one of them.

When adding a rule to the CEO, write at most the sentence that makes it mandatory in the core prompt
and put the details in the topic's skill. Never concatenate into the core prompt an instruction block
shared with the executor agents, such as `USER_QUESTIONS_INSTRUCTIONS`.

### Who can name whom

An executor agent's prompt describes only itself. It receives `team` in
`buildSystemPrompt(team)` and ignores it, so it has no "Your Team" section, and naming another role
inside it creates a reference to something the agent does not know. Scope limits are written in the
negative about the agent itself ("outside your scope; return it to the caller"), never pointing to the
role that takes over the task.

Only the CEO's prompt sees the team, and even there the knowledge about each agent lives in the
definition's `description`, rendered in "Your Team". The generic instructions in the CEO's prompt
do not mention roles: a new agent gets routed by writing its own `description`, without
editing the CEO's prompt.

## Specialized System Prompts

The specialized prompts live in `packages/server/src/modules/agent-definitions/prompts/`:

Every agent prompt ends with `FINAL_RESPONSE_INSTRUCTIONS` (`final-response.prompt.ts`): the
turn's final response comes exactly once inside `<final_response>…</final_response>`
(`orchestrator/constants/final-response.constant.ts`), and text outside it is only progress narration.
A new agent must include this block, because the orchestrator uses the envelope to separate the response
from the narration.

### 1. Developer Agent (`developer.prompt.ts`)

- Acts as an autonomous senior software engineer, adaptable to any language, stack or architecture;
- Does the project orientation before its first action in the session and strictly adheres to the target project's architecture, conventions, linter and documentation;
- Adopts the idiomatic patterns and conventions already established in the existing codebase when there is no formal documentation;
- Ensures quality through comprehensive automated tests and validation with the target project's build, test and linter commands;
- Uses the command the project documents for the task rather than reproducing its steps manually, including when the command accesses the network, such as installing dependencies or an init script that clones sub-repositories;
- Incorporates the commit conventions (Conventional Commits in English, unless the project's own conventions say otherwise) and the commit safety rules; declares standalone Git operations against a remote as outside its own scope and returns them to the caller rather than running them, without naming who runs them;
- Implements the task it holds (`[DELEGATED_ARTIFACT]`) on a local branch of its own (the one recorded on the task, else the project's convention or `<type>/<task id>-<slug>`), and records the branch and the `implementation_notes` on the task before its final answer; resumed to fix the findings in `review_findings` or `test_report`, it appends to the notes;
- Has the `DEVELOPER_TURN_REMINDER` configured in its definition, reinforcing on every turn adherence to conventions, automated tests and the `<final_response>` envelope.

### 2. CEO (`ceo.prompt.ts`)

- Leads and orchestrates the agent team in `agent-remote-control`, acting as the primary conversational interface with the user (via Discord and other channels);
- Understands the `workspaces` directory as a multi-project container; lists the CWD to discover active projects, since each direct subfolder is a project;
- Anchors scope and answers to the user in the projects that actually exist in the workspace, proposing to clone or start new ones if it is empty;
- Operates confined by default to `workspaces` and its subfolders; acting outside the workspace is dangerous and requires an explicit risk warning and mandatory prior confirmation from the user before proceeding;
- Acts as a pure orchestrator: never performs technical tasks directly, does not create or change project files, does not run tests, builds or linters, and does not commit. All hands-on technical work must be delegated to the team's specialist agents. When no agent on the team can handle the request, it reports the limitation to the user without attempting the task;
- Triages requests and turns ambiguous requirements into tasks with a self-contained specification and acceptance criteria;
- Receives the core prompt (`buildCeoSystemPrompt(team)`, wrapped in `[ORCHESTRATOR_INSTRUCTIONS]`) with every user message via `systemPromptEveryTurn`, with the rules that cannot be lost in compaction (see "CEO's lean core prompt"): pure orchestration, the three response outcomes — `<delegate>`, `<question>` or a response without tags —, the `<delegate>` shapes per agent, text outside the tags as a message to the user, that agents ask the user directly and the CEO receives only the final result, answering every pending request, the project folder as an existing direct subfolder, when to use `session="new"`, access requests outside the CWD and the `<attachment>` tag. It also carries the workspace as a multi-project container, its boundaries and the conversation style. The details live in its skills (`agent-team`, `artifact-board`, `delegation-protocol`, `response-protocol`, `workspace-navigation`, `skill-authoring`), listed in the `[SKILLS]` catalog sent with the prompt and read with `<skill_read>`; the core prompt says nothing of how skills work, which the catalog explains as it does to every agent;
- Creates and changes the skills of any role when the user asks, through `<skill_list/>` and `<skill_write>` (the `skill-authoring` skill), never writing skill files itself;
- Knows its team through the core prompt's "Your Team" section (role, name and `<delegate>` shapes derived from `delegation`) and through the `agent-team` skill, which carries each agent's full `description`. The delegation section is agnostic to fixed roles: task routing and phase sequencing (such as planning before execution and review before completion) are driven exclusively by the specializations described dynamically in the "Your Team" catalog. A conversation runs one agent per role, so phases are ordered by dependency per item and different items overlap across roles in a pipeline (plan project 1; develop 1 while planning 2; review 1 while developing 2 while planning 3), with every independent task delegated in the same response (`delegation-protocol` skill). The CEO receives each result as its agent finishes and the `[TEAM_PROFILES]` list (every role with coding agent, model, effort and idle or working state; a working role adds project, running time, wait state and the task summary) and `<agent_result>` tagged with the coding agent, model and effort that ran it with the user's messages and when the list changes. When the coding agent of a role differs from the last list, the skill tells the CEO to restate the goal, state of the work and decisions in the next specification, because the role starts a new session; a change of model or effort alone keeps the session. That is why each definition's `description` must say when to delegate to it;
- Copies verbatim into the next specification the recommended commands and already verified facts that come in the agents' results, and asks for the command documented by the project rather than a manual reproduction of its steps;
- Delegates with `<delegate>` tags inside the final response envelope, using a team role, and reviews each `<agent_result>` before answering; asks the user with `<question>` and continues the turn with `<user_answers>`; a response with neither tag ends the turn;
- Does not interview the user about requirements: the `agent-team` skill puts discovery before technical planning and leaves it to the agent that runs it. All the work goes through the board of the conversation ("### The Board" in the core prompt, details in the `artifact-board` skill): for each request it lists the board, adds the request to an open artifact or creates a task or feature with its refinement path, delegates with `artifact="T-1"` (the agent receives the content, so the specification says only what to do now), and after each `<agent_result>` sets the status and refinements the result calls for. Its artifact requests come back as `<request_results>` in the same turn and are not an outcome. A document an agent produces outside the workspaces root is attached to the response and its path authorized for the next agent. Confirmation for access outside the workspace is requested with `<question>`;
- Requires the project folder parameter (`project-folder`) to always be the project's top-level root directory, never nested paths or internal subfolders, ensuring the specialist starts its execution at the workspace root where the governance and documentation files live; details of narrow scopes or subdirectories belong in the task specification;
- Reads `workspace-manifest.json` to locate repositories by URL, without writing it;
- Converses naturally and in proportion to the message, following the confinement and protocol rules without mentioning them to the user;
- When the user questions a decision of the CEO itself, answers in the same turn with the context it already has, and delegates only if the answer depends on information it does not yet have; when the user asks it to stop, it stops delegating;
- Does not perform direct technical execution, since implementation belongs exclusively to the team's specialist agents.

### 3. Code Reviewer Agent (`code-reviewer.prompt.ts`)

- Reviews the work on the task it holds (`[DELEGATED_ARTIFACT]`), against the task (acceptance criteria, technical solution, tests) and the project's conventions, with fresh eyes (`defaultSessionMode: 'new'`): its open pull request when there is one, otherwise its branch locally against the base (the default branch unless the instruction names another) with read-only Git commands (`git merge-base`, `git log`, `git diff <base>...<branch>`, `git show`), never checking out, committing, merging or changing branches;
- Never runs the project, its tests, builds or linters: in a pull request review it reads the status and results of the checks, reporting failing checks as findings and stating checks still running or absent; a local review states that nothing was run;
- Reports only real findings (file, line, severity high/medium/low, problem, impact, suggested fix) and modifies no file;
- Always replaces the task's `review_findings` section with the verdict, what it reviewed (pull request URL, or branch, base and commit range), the state of the checks or that the review was local, and the numbered findings, where whoever fixes the task reads them;
- In a pull request review also publishes every finding on the pull request without asking, detecting the provider with `git remote -v` and following `MCP -> Official CLI -> No Fallback` (no `curl` or raw REST; without tooling the findings stay on the task only), inline findings anchored to the new line (`side: RIGHT` / `new_line` / `rightFileStart`), the rest in the discussion, and submits approve or request changes when the provider supports it;
- Verdict: APPROVED without high or medium findings and failing checks, CHANGES_REQUESTED otherwise; the final answer opens with it, then what was reviewed and the count of findings per severity;
- Contract `project: 'required'`, `readOnly`, `artifact: 'required'` with `needsReviewableWork`; artifact access `task` writing only `review_findings`; does not receive `USER_QUESTIONS_INSTRUCTIONS`; has the `CODE_REVIEWER_TURN_REMINDER`.

### 4. Tech Lead Agent (`tech-lead.prompt.ts`)

- Acts as software architect and technical lead responsible for in-depth requirements analysis, architecture exploration and up-front impact assessment in the repository;
- Analytical, general-purpose persona: answers architectural queries, investigations and trade-off analysis of libraries/technologies, and refines the board technically;
- Operates under strictly read-only discipline: does not change project files, does not generate production code, does not commit and writes no file; everything it produces goes to the board;
- Decision discipline: ambiguities, architectural trade-offs and unconfirmed technologies are user decisions, asked with `<question>` before writing the solution — one option per viable approach, the justified recommendation as the first option and pros and cons in the `rationale`;
- Does the project orientation, treats local skills and architectural guides as authoritative and asks which one prevails when documentation, code and request diverge;
- Writes the `technical_solution` of each task (design, decisions with rationale, exact files, ordered steps, tests to add, verification commands), the shared architecture on the feature, splits work too large for one pull request into dependent tasks of the same feature, complements `test_cases` and `acceptance_criteria`, settles `pending_decisions` and sets `technical_refinement="done"`; the final answer gives the ids it touched, the order between tasks and what the caller must decide;
- Contract `project: 'optional'`, `readOnly`, `artifact: 'optional'`, `defaultSessionMode: 'resume'` for iterative refinements, and the `TECH_LEAD_TURN_REMINDER`.

### 5. Git Ops Agent (`git-ops.prompt.ts`)

- Owner of every Git operation that reaches a remote: clone, init, fetch, pull, push, merge and rebase against remote branches, remote configuration, pull requests and SSH key setup;
- Leaves the local side to the implementing agent: staging, commit, local branch and working tree inspection. Destructive operations (force push, deleting remote branches or tags, discarding uncommitted or unpushed work) run only on an explicit instruction that names the operation and its target; a rejected push or failure is never one. They use the narrowest form: `--force-with-lease` for force push, one named ref per deletion, never `--all`, `--mirror` or wildcard refspecs;
- Operates in one of two directories, decided by the caller: the workspaces root, to clone or locate a repository, and a project folder, for operations on that repository. That is why its contract declares `project: 'optional'`;
- Sole reader and writer of `workspace-manifest.json` at the workspaces root, a JSON array of `{ url, folder, defaultBranch }` that maps repository URL to project folder. A missing file means an empty workspace;
- Derives the folder name from the last segment of the URL without the `.git` suffix, an exact rule because the caller routes subsequent work by that name and a different name would duplicate the clone;
- Reports in `GIT_OPS_TURN_REMINDER` the project folder used, since that is how the CEO learns where to route the follow-up;
- With a task (`artifact: 'optional'`), pushes its branch, opens its pull request (titled with the task id and title, described from the task) and links every pull request it opens, merges or closes on the task with its state.

### 6. Product Owner Agent (`product-owner.prompt.ts`)

- Senior business analyst running discovery with whoever knows the business, assuming the person is not technical. Extracts and consolidates the intent, without solving it, estimating effort, assessing feasibility or choosing technology; the user is the source of truth and the code is context;
- Hunts for the unsaid starting from an initial list that is not a limit: who executes, approves and is notified; missing or wrong data; lack of permission; interruption midway; volume and batches; retroactivity and existing data; auditing; irreversible actions; limits, deadlines, currencies, units and time zones; concurrency; what the end user sees (empty states, waiting, errors, accessibility, channels); notifications; personal data; success metric;
- Hard language rule: no technical jargon in what it writes, with free reading of the code, whose findings are current behavior and become questions, never rules;
- Technical boundary: technical decisions are recorded in `pending_decisions` (decision, business impact, who decides, what it blocks), without asking or deciding; the only exception is a choice that changes visible behavior, asked as behavior;
- Runs the interview only through `<question>`, with no round limit, starting with scope and actors;
- Blocking guardrails: read-only on files (it writes only to the board); never invent a rule; a conflict with documentation becomes a question; a divergence between system and documentation becomes a question and is recorded in `pending_decisions`; an unreadable cited document becomes a question;
- Consolidates on the board: the initiative becomes a feature in its project broken into deliverable tasks with sibling dependencies (or a single task), each with `overview`, `scope`, `user_stories`, `business_rules`, `flows`, `acceptance_criteria`, `test_cases`, `glossary`, `pending_decisions` and, only for what the user declared not to know, `open_questions`; it refines what exists instead of duplicating it, runs a checklist before writing and sets `business_refinement="done"`; the final answer gives the ids, a line each, the dependencies and the pending technical decisions;
- Contract `project: 'optional'` (with a folder it does the project orientation and reads the code; without a folder it discusses the idea from scratch), `artifact: 'optional'`, `readOnly`, `defaultSessionMode: 'resume'`, and the `PRODUCT_OWNER_TURN_REMINDER`.

### 7. QA Agent (`qa.prompt.ts`)

- Tests the task it holds (`[DELEGATED_ARTIFACT]`) in practice: its acceptance criteria and test cases are the test plan, plus the edge cases they imply;
- Switches to the task's branch only when the working tree is clean, identifies the kind of application, reads the matching skills before testing and starts the application as the project documents it;
- Never changes the project's code, configuration, tests or manifest and never commits; throwaway scripts go in a temporary folder of its working directory. Before its final answer it stops what it started, deletes what it created and switches back to the branch it found, leaving `git status` as it was;
- Replaces the task's `test_report` section with the verdict, what it tested (branch, commit, how the application ran), the numbered tests with expected and actual results, the evidence of each failure and what it could not test. PASSED only when every acceptance criterion and test case passed; an untested criterion makes it FAILED. The final answer opens with the verdict;
- Contract `project: 'required'`, `artifact: 'required'` with `needsReviewableWork`, `defaultSessionMode: 'resume'` to test again after a fix; artifact access `task` writing only `test_report`; the four testing skills; does not receive `USER_QUESTIONS_INSTRUCTIONS`; has the `QA_TURN_REMINDER`.

## Registry Service (`AgentRegistryService`)

The `AgentRegistryService` class implements the `IAgentRegistryPort` port from `packages/server/src/modules/orchestrator/ports/agent-registry.port.ts`:

- `getSystemPrompt(agentRole: string)`: resolves the definition case-insensitively and calls `buildSystemPrompt` with all other registered definitions. Unregistered roles receive a generic prompt;
- `getDefaultModel(agentRole: string)`: returns the identifier of the preferred model associated with the role;
- `getDefaultSessionMode(agentRole: string)`: returns the role's default session mode (`'resume' | 'new'`), falling back to `'resume'` if not configured or unknown;
- `getTurnReminder(agentRole: string)`: returns the turn reminder associated with the role (`turnReminder`), an empty string for a definition without a reminder, or a default fallback text for unregistered roles (always a string);
- `isSystemPromptEveryTurn(agentRole: string)`: indicates whether the role receives the system prompt with every user message (`false` for an unknown role);
- `getArtifactAccess(agentRole: string)`: returns the role's `ArtifactAccess`, read-only access to tasks for an unknown role;
- `getTeam(agentRole: string)`: every definition but the role's own (all of them for an unknown role), the team its prompt and skills are built with;
- `hasRole(agentRole: string)`: indicates, case-insensitively, whether the role is registered;
- `listRoles()`: returns the role of every registered definition, in registration order;
- `getDefinition(roleOrId: string)`: retrieves the full `AgentDefinition` entity;
- `getAllDefinitions()`: lists all registered definitions;
- `registerDefinition(definition: AgentDefinition)`: allows dynamic inclusion or overriding at runtime. A registered agent appears in the "Your Team" section of the CEO's prompt.

The `AgentDefinitionsModule` registers `IAgentRegistryPort` with `useExisting: AgentRegistryService`, guaranteeing a single instance. With `useClass`, definitions registered through the exported class would not reach the orchestrator.
It also binds `IUserSkillStorePort` to `FileUserSkillStoreAdapter` (importing `PathsModule` for `DATA_DIR`) and exports `IAgentSkillsPort`, bound to `AgentSkillsService`.
