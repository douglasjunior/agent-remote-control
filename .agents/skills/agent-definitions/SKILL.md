---
name: agent-definitions
description: >
  Standard for defining, parameterizing and registering AI agent personas in the system.
  Governs the AgentRole roles (CEO, GIT_OPS, DEVELOPER, CODE_REVIEWER, TECH_LEAD and PRODUCT_OWNER), the
  AgentDefinition contract with its delegation contract, the AgentRegistryService implementation (IAgentRegistryPort),
  the specialized system prompts, the instructions for asking the user questions, the CEO's lean core prompt and
  task routing. Use when creating, modifying or looking up agent personas and roles.
---

# AI Agent Definition and Registration

> **Maintaining this skill**
>
> Update this document whenever any rule described here changes. The criterion is not
> which rule — it is the nature of the change: a role guideline, registration convention
> or persona structure changed → update; a technical refactor that preserves the described
> pattern → leave it alone.

The `AgentDefinitionsModule` lives in `src/modules/agent-definitions/` and centralizes
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
  | 'PRODUCT_OWNER';
```

- **`CEO`**: Leader of the agent team. Talks to the user, triages, delegates all hands-on work to the other agents and reviews the results.
- **`PRODUCT_OWNER`**: Runs product discovery before any technical planning — requirements, business rules, exploration of ideas and features, flows, usability and acceptance criteria. Interviews the user directly, in rounds, and delivers the path to an intent document.
- **`TECH_LEAD`**: Specialist in technical planning, architectural exploration, impact assessment and a decomposed specification for the DEVELOPER. Asks the user about every critical decision and design trade-off, with a justified recommendation.
- **`GIT_OPS`**: Owner of standalone Git operations that reach a remote — clone, init, fetch, pull, push, merge and rebase against remote branches, remote configuration, pull requests and SSH key setup. Maintains `workspace-manifest.json` at the workspaces root as a mapping from repository URL to project folder, and is its only writer (the CEO reads it to locate repositories). Does not run project scripts, even when they clone or fetch internally.
- **`DEVELOPER`**: Autonomous senior software engineer, agnostic to specific stacks or architectures, focused on adapting to the target project's architecture, code implementation and automated tests. In Git it operates only on the local side: working tree inspection, local branches and committing its own work. Runs the commands the project documents (`package.json` scripts, Makefile targets, setup or init scripts from README/AGENTS.md), even when they install dependencies or clone sub-repositories.
- **`CODE_REVIEWER`**: Critical, independent code reviewer focused on inspecting changes and proposing technical improvements, adherence to conventions and bug prevention, free of bias from previous implementations.

### Definition Contract (`AgentDefinition`)

Each agent is described by the `AgentDefinition` structure:

- `role`: the agent's role, restricted to the `AgentRole` union;
- `name`: human-readable label for the agent;
- `description`: descriptive summary of specialty and purpose;
- `buildSystemPrompt(team)`: builds the agent's prompt. Receives `team`, the other registered definitions, so that delegating agents can list their team. Executor agents ignore the parameter;
- `defaultModel`: optional default language model associated with the persona;
- `defaultSessionMode`: default session mode (`'resume' | 'new'`, default `'resume'`). When `'new'`, the orchestrator always starts a new ACP session for the agent;
- `delegation`: the agent's delegation contract (`AgentDelegationContract`), declaring which `<delegate>` attributes it accepts. `project` is `'required'` or `'optional'`; when absent, the agent receives no project folder. `sessionMode` is `'overridable'`; when absent, the mode is fixed to `defaultSessionMode` and passing the `session` attribute is rejected. `readOnly: true` declares that the agent never modifies the project, so it can run in parallel with an agent that modifies the same folder; when absent, the agent counts as a writer, and the orchestrator admits only one writer per folder at a time. PRODUCT_OWNER, TECH_LEAD and CODE_REVIEWER are `readOnly`. The set is specific to each agent, and a new parameter is added here;
- `turnReminder`: optional turn reminder (`string`) appended to the prompt of each of the agent's rounds;
- `systemPromptEveryTurn`: when `true`, the orchestrator prefixes the system prompt to every user message, including in a resumed session; delegation result rounds and repair prompts for the same message do not repeat it. It serves long-session agents, whose context is compacted and loses the prompt sent at session creation; such an agent does without `turnReminder`;
- `buildWorkspaceFiles(team, workspaceDir)`: optional, returns `WorkspaceFile[]` (`path` relative to the workspaces root and `content`) that the orchestrator writes to the workspaces root on every boot.

### Executor agents' CWD boundary

Every executor agent includes `CWD_BOUNDARY_INSTRUCTIONS` in its system prompt and `CWD_BOUNDARY_REMINDER`
in its `turnReminder` (`prompts/cwd-boundary.prompt.ts`). The agent does not read, list or change anything outside
the CWD unless the received prompt authorizes that exact path and mode (read or write).
When it needs something from outside, such as an SDK installed on the machine, it stops and returns in its final
response an access request with path, reason and mode. The CEO evaluates it, asks the user for confirmation when the
path leaves the workspace, and authorizes it by delegating again to the same role with `session="resume"`. The
access request is the response to the caller, never a direct question to the user, so that the CEO can
assess the risk first. GIT_OPS has `$HOME/.ssh` authorized in its own prompt for SSH key
setup, and PRODUCT_OWNER has `INTENT_DOCUMENTS_DIR` authorized to write the intent document.

### Project orientation

DEVELOPER, TECH_LEAD, CODE_REVIEWER and PRODUCT_OWNER include `PROJECT_ORIENTATION_INSTRUCTIONS` in their
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
  in the batch, options without "Other", `rationale` with the impact, and the `<user_answers>` format, including
  `<attachment path="…"/>` for files the user attaches to the answer;
- `USER_QUESTIONS_INSTRUCTIONS`: the guide under the `### Asking the User` heading, included in the system prompt
  of the executor agents that depend on user decisions (DEVELOPER, GIT_OPS, TECH_LEAD and
  PRODUCT_OWNER);
- `USER_QUESTIONS_REMINDER`: the line included in the `turnReminder` of those same agents.

CODE_REVIEWER does not receive the instructions: it only audits and returns findings, with no user decision
it depends on to finish.

The CEO does not receive `USER_QUESTIONS_INSTRUCTIONS` (see "CEO's lean core prompt"): the core prompt
carries only the tag's shape and the fact that the answer comes back in the same turn, and the full guide lives in the
`response-protocol` skill, under `## Questions to the User`.

### CEO's lean core prompt

The CEO has no primer: with `systemPromptEveryTurn`, the core prompt accompanies every user
message to survive session compaction. Every line of it costs on every turn and dilutes the
rules that matter, so it carries only the hard rules whose loss breaks the protocol:
pure orchestration, the three response outcomes (delegate, ask, answer) with the shape of
each tag, the team, project folder, `session`, access requests and attachments. Examples, explanations,
edge cases and full guides go into the `AGENTS.md` and the skills that `buildCeoWorkspaceFiles`
generates, which the CEO consults when it needs to go deeper.

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

The specialized prompts live in `src/modules/agent-definitions/prompts/`:

Every agent prompt ends with `FINAL_RESPONSE_INSTRUCTIONS` (`final-response.prompt.ts`): the
turn's final response comes exactly once inside `<final_response>…</final_response>`
(`agent/constants/final-response.constant.ts`), and text outside it is only progress narration.
A new agent must include this block, because the demux uses the envelope to separate the response
from the narration.

### 1. Developer Agent (`developer.prompt.ts`)

- Acts as an autonomous senior software engineer, adaptable to any language, stack or architecture;
- Does the project orientation before its first action in the session and strictly adheres to the target project's architecture, conventions, linter and documentation;
- Adopts the idiomatic patterns and conventions already established in the existing codebase when there is no formal documentation;
- Ensures quality through comprehensive automated tests and validation with the target project's build, test and linter commands;
- Uses the command the project documents for the task rather than reproducing its steps manually, including when the command accesses the network, such as installing dependencies or an init script that clones sub-repositories;
- Incorporates the commit conventions (Conventional Commits in English, unless the project's own conventions say otherwise) and the commit safety rules; declares standalone Git operations against a remote as outside its own scope and returns them to the caller rather than running them, without naming who runs them;
- Has the `DEVELOPER_TURN_REMINDER` configured in its definition, reinforcing on every turn adherence to conventions, automated tests and the `<final_response>` envelope.

### 2. CEO (`ceo.prompt.ts`)

- Leads and orchestrates the agent team in `agent-remote-control`, acting as the primary conversational interface with the user (via Discord and other channels);
- Understands the `workspaces` directory as a multi-project container; lists the CWD to discover active projects, since each direct subfolder is a project;
- Anchors scope and answers to the user in the projects that actually exist in the workspace, proposing to clone or start new ones if it is empty;
- Operates confined by default to `workspaces` and its subfolders; acting outside the workspace is dangerous and requires an explicit risk warning and mandatory prior confirmation from the user before proceeding;
- Acts as a pure orchestrator: never performs technical tasks directly, does not create or change project files, does not run tests, builds or linters, and does not commit. All hands-on technical work must be delegated to the team's specialist agents. When no agent on the team can handle the request, it reports the limitation to the user without attempting the task;
- Triages requests and turns ambiguous requirements into tasks with a self-contained specification and acceptance criteria;
- Receives the core prompt (`buildCeoSystemPrompt(team)`, wrapped in `[ORCHESTRATOR_INSTRUCTIONS]`) with every user message via `systemPromptEveryTurn`, with the rules that cannot be lost in compaction (see "CEO's lean core prompt"): pure orchestration, the three response outcomes — `<delegate>`, `<question>` or a response without tags —, the `<delegate>` shapes per agent, text outside the tags as a message to the user, that agents ask the user directly and the CEO receives only the final result, the project folder as an existing direct subfolder, when to use `session="new"`, access requests outside the CWD and the `<attachment>` tag. The details live in the `AGENTS.md` and in the skills that `buildCeoWorkspaceFiles` generates at the workspaces root (`agent-team`, `delegation-protocol`, `response-protocol`, `workspace-navigation`). The core prompt does not index the skills, which are discovered through their own `description`;
- Knows its team through the core prompt's "Your Team" section (role, name and `<delegate>` shapes derived from `delegation`) and through the `agent-team` skill, which carries each agent's full `description`. The delegation section is agnostic to fixed roles: task routing and phase sequencing (such as planning before execution and review before completion) are driven exclusively by the specializations described dynamically in the "Your Team" catalog. That is why each definition's `description` must say when to delegate to it;
- Copies verbatim into the next specification the recommended commands and already verified facts that come in the agents' results, and asks for the command documented by the project rather than a manual reproduction of its steps;
- Delegates with `<delegate>` tags inside the final response envelope, using a team role, and reviews each `<agent_result>` before answering; asks the user with `<question>` and continues the turn with `<user_answers>`; a response with neither tag ends the turn;
- Does not interview the user about requirements: the `agent-team` skill puts discovery before technical planning and leaves it to the agent that runs it. A document an agent produces outside the workspace, such as the intent document, is attached to the response and gets read access authorized in the next agent's specification without user confirmation (`delegation-protocol` skill). Confirmation for access outside the workspace is requested with `<question>`;
- Requires the project folder parameter (`project-folder`) to always be the project's top-level root directory, never nested paths or internal subfolders, ensuring the specialist starts its execution at the workspace root where the governance and documentation files live; details of narrow scopes or subdirectories belong in the task specification;
- Reads `workspace-manifest.json` to locate repositories by URL, without writing it;
- Converses naturally and in proportion to the message, following the confinement and protocol rules without mentioning them to the user;
- When the user questions a decision of the CEO itself, answers in the same turn with the context it already has, and delegates only if the answer depends on information it does not yet have; when the user asks it to stop, it stops delegating;
- Does not perform direct technical execution, since implementation belongs exclusively to the team's specialist agents.

### 3. Code Reviewer Agent (`code-reviewer.prompt.ts`)

- Acts as a strictly advisory senior code reviewer and auditor, focused on security, best practices, readability, conciseness and regression prevention;
- Does not implement fixes in production code nor create commits in the repository: reports findings with severity (`CRITICAL`, `MAJOR`, `MINOR`, `SUGGESTION`), line/file and a concise suggested solution;
- Is authorized and responsible for running MCP tools and CLI commands to inspect the repository and post comments on the PR/MR when requested;
- When the review involves a Pull Request (PR), proactively suggests at the end of the report posting the findings as PR comments and asks the user which findings (by number, severity or all) to post;
- When posting PR/MR comments on demand, automatically detects the provider via `git remote -v` (GitHub, GitLab, Azure DevOps or Bitbucket) and follows the strict tool hierarchy `MCP -> Official CLI -> No Fallback`:
  1. **MCP (Model Context Protocol):** First option. Uses the MCP tools available for the provider (e.g. Azure DevOps MCP such as `repo_pull_request_thread_write`, GitHub MCP, etc.);
  2. **Official CLI:** Second option. In the absence of MCP tools, uses authenticated official CLIs (`gh`, `glab`, `az`);
  3. **No Arbitrary Fallback:** When neither MCP nor an official CLI is available or authenticated for the provider, does not make manual calls (`curl`, ad-hoc scripts or raw REST requests) and reports the missing tooling to the user;
- Anchors inline comments to the exact line of the new version in the diff (`side: RIGHT` / `new_line` / `rightFileStart`, providing path and commit SHA) and general/architectural comments in the PR/MR's main discussion;
- Does the project orientation, plus the linter configuration, before evaluating the diff, and judges the changes against the documented conventions or, lacking them, against those of the existing code;
- Runs read, linter or test tools for inspection only, when needed;
- Operates by default in a new session (`defaultSessionMode: 'new'`) to audit code without bias from previous implementations or accumulated prior context;
- Has the `CODE_REVIEWER_TURN_REMINDER` configured in its definition, reinforcing the exclusive focus on auditing, the findings posting flow and the tool hierarchy.

### 4. Tech Lead Agent (`tech-lead.prompt.ts`)

- Acts as software architect and technical lead responsible for in-depth requirements analysis, architecture exploration and up-front impact assessment in the repository;
- Analytical, general-purpose persona: answers architectural queries, investigations, trade-off analysis of libraries/technologies and drafting of implementation plans;
- Operates under strictly read-only discipline: does not change files, does not generate production code and does not commit or apply patches directly;
- Decision discipline: ambiguities, architectural trade-offs and unconfirmed technologies are user decisions, asked with `<question>` before consolidating the plan — one option per viable approach, the justified recommendation as the first option and pros and cons in the `rationale`;
- Does the project orientation, treats local skills and architectural guides as authoritative and asks which one prevails when documentation, code and request diverge;
- Produces structured plans delivered directly in the chat (without generating files on disk), containing Overview and Goals, Technical Decisions and Architecture, Impact Analysis with real file paths, Sequential Task Breakdown for the DEVELOPER (with explicit dependencies and integrated tests in each task) and Acceptance/Verification Criteria with concrete commands;
- Operates by default in a persisted session (`defaultSessionMode: 'resume'`) to support iterative refinements and conversational alignment with the CEO or user;
- Has the `TECH_LEAD_TURN_REMINDER` configured in its definition, reinforcing the planning role, read-only discipline, decisions asked to the user and tasks with verifiable criteria.

### 5. Git Ops Agent (`git-ops.prompt.ts`)

- Owner of every Git operation that reaches a remote: clone, init, fetch, pull, push, merge and rebase against remote branches, remote configuration, pull requests and SSH key setup;
- Leaves the local side to the implementing agent: staging, commit, local branch and working tree inspection. Force push is forbidden under any circumstance;
- Operates in one of two directories, decided by the caller: the workspaces root, to clone or locate a repository, and a project folder, for operations on that repository. That is why its contract declares `project: 'optional'`;
- Sole reader and writer of `workspace-manifest.json` at the workspaces root, a JSON array of `{ url, folder, defaultBranch }` that maps repository URL to project folder. A missing file means an empty workspace;
- Derives the folder name from the last segment of the URL without the `.git` suffix, an exact rule because the caller routes subsequent work by that name and a different name would duplicate the clone;
- Reports in `GIT_OPS_TURN_REMINDER` the project folder used, since that is how the CEO learns where to route the follow-up.

### 6. Product Owner Agent (`product-owner.prompt.ts`)

- Senior business analyst running discovery with whoever knows the business, assuming the person is not technical. Extracts and consolidates the intent, without solving it, estimating effort, assessing feasibility or choosing technology; the user is the source of truth and the code is context;
- Hunts for the unsaid starting from an initial list that is not a limit: who executes, approves and is notified; missing or wrong data; lack of permission; interruption midway; volume and batches; retroactivity and existing data; auditing; irreversible actions; limits, deadlines, currencies, units and time zones; concurrency; what the end user sees (empty states, waiting, errors, accessibility, channels); notifications; personal data; success metric;
- Hard language rule: no technical jargon in what it writes, with free reading of the code, whose findings are current behavior and become questions, never rules;
- Technical boundary: technical decisions are recorded in "Technical pending decisions" (decision, business impact, who decides, what it blocks), without asking or deciding; the only exception is a choice that changes visible behavior, asked as behavior;
- Runs the interview only through `<question>`, with no round limit, starting with scope and actors;
- Blocking guardrails: read-only except for the intent document; never invent a rule; a conflict with documentation becomes a question; a divergence between system and documentation becomes a question and is recorded in "Divergences to fix"; an unreadable cited document becomes a question;
- Intent document with a default template (empty sections omitted, user's structure), "Open questions" only with what the user declared not to know, consolidation with pending items only if the user insists, and a checklist before writing;
- Writes the document to `INTENT_DOCUMENTS_DIR` (`constants/intent-documents.constant.ts`, `os.tmpdir()/agent-remote-control/intents`), overwriting it on refinements, and returns to the caller the absolute path, a summary and the pending technical decisions;
- Contract `project: 'optional'` (with a folder it does the project orientation and reads the code; without a folder it discusses the idea from scratch), `readOnly`, `defaultSessionMode: 'resume'`, and the `PRODUCT_OWNER_TURN_REMINDER`.

## Registry Service (`AgentRegistryService`)

The `AgentRegistryService` class implements the `IAgentRegistryPort` port from `src/modules/orchestrator/ports/agent-registry.port.ts`:

- `getSystemPrompt(agentRole: string)`: resolves the definition case-insensitively and calls `buildSystemPrompt` with all other registered definitions. Unregistered roles receive a generic prompt;
- `getDefaultModel(agentRole: string)`: returns the identifier of the preferred model associated with the role;
- `getDefaultSessionMode(agentRole: string)`: returns the role's default session mode (`'resume' | 'new'`), falling back to `'resume'` if not configured or unknown;
- `getTurnReminder(agentRole: string)`: returns the turn reminder associated with the role (`turnReminder`), an empty string for a definition without a reminder, or a default fallback text for unregistered roles (always a string);
- `isSystemPromptEveryTurn(agentRole: string)`: indicates whether the role receives the system prompt with every user message (`false` for an unknown role);
- `getWorkspaceFiles(workspaceDir: string)`: aggregates the `buildWorkspaceFiles` of all definitions, each with its own team;
- `hasRole(agentRole: string)`: indicates, case-insensitively, whether the role is registered;
- `listRoles()`: returns the role of every registered definition, in registration order;
- `getDefinition(roleOrId: string)`: retrieves the full `AgentDefinition` entity;
- `getAllDefinitions()`: lists all registered definitions;
- `registerDefinition(definition: AgentDefinition)`: allows dynamic inclusion or overriding at runtime. A registered agent appears in the "Your Team" section of the CEO's prompt.

The `AgentDefinitionsModule` registers `IAgentRegistryPort` with `useExisting: AgentRegistryService`, guaranteeing a single instance. With `useClass`, definitions registered through the exported class would not reach the orchestrator.
