---
name: agent-definitions
description: >
  Standard for defining, parameterizing and registering AI agent personas in the system.
  Governs the AgentRole roles (CEO, GIT_OPS, DEVELOPER, CODE_REVIEWER, TECH_LEAD, PRODUCT_OWNER, QA and IT_SUPPORT), the
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

## Reference files

- [references/agent-skills.md](references/agent-skills.md): the built-in skills per role, the user skill store and
  the validation of skill writes. Read it when adding a skill or changing how skills are stored or merged.
- [references/registry-service.md](references/registry-service.md): every `AgentRegistryService` method and its
  fallback for an unknown role. Read it when changing the registry or the `IAgentRegistryPort` contract.
- One file per role (below) with its full role description, what its specialized prompt prescribes, its contract and
  its board access. Read the one of the role you are creating, changing or routing to.

## Functional Roles (`AgentRole`)

```typescript
export type AgentRole =
  | 'CEO'
  | 'GIT_OPS'
  | 'DEVELOPER'
  | 'CODE_REVIEWER'
  | 'TECH_LEAD'
  | 'PRODUCT_OWNER'
  | 'QA'
  | 'IT_SUPPORT';
```

| Role | Summary | Prompt reference |
|---|---|---|
| `CEO` | Leads the team: talks to the user, triages, delegates all hands-on work and reviews the results. | [ceo-prompt.md](references/ceo-prompt.md) |
| `PRODUCT_OWNER` | Product discovery with the user before technical planning; writes the business sections of a feature and its tasks. | [product-owner-prompt.md](references/product-owner-prompt.md) |
| `TECH_LEAD` | Technical planning and impact assessment; writes each task's technical solution and splits large work. | [tech-lead-prompt.md](references/tech-lead-prompt.md) |
| `GIT_OPS` | Git operations that reach a remote, pull requests and SSH keys; sole writer of `workspace-manifest.json`. | [git-ops-prompt.md](references/git-ops-prompt.md) |
| `DEVELOPER` | Implements a task with tests, adapting to the project; local Git only. | [developer-prompt.md](references/developer-prompt.md) |
| `CODE_REVIEWER` | Independent review of a task's pull request or branch without running it; APPROVED or CHANGES_REQUESTED. | [code-reviewer-prompt.md](references/code-reviewer-prompt.md) |
| `QA` | Tests a reviewed task by running the application, preparing its own environment with local changes it never commits; PASSED or FAILED. | [qa-prompt.md](references/qa-prompt.md) |
| `IT_SUPPORT` | Environment and system administration of the machine (installs, OS settings, services, variables, SDKs): investigates read-only, asks the user to approve a plain-language plan and changes nothing before the approval. The CEO only suggests it. | [it-support-prompt.md](references/it-support-prompt.md) |

## Definition Contract (`AgentDefinition`)

- `role`: the agent's role, restricted to the `AgentRole` union;
- `name`: human-readable label for the agent;
- `description`: descriptive summary of specialty and purpose;
- `buildSystemPrompt(team)`: builds the agent's prompt. Receives `team`, the other registered definitions, so that delegating agents can list their team. Executor agents ignore the parameter;
- `defaultModel`: optional default language model associated with the persona;
- `defaultSessionMode`: default session mode (`'resume' | 'new'`, default `'resume'`). When `'new'`, the orchestrator always starts a new ACP session for the agent;
- `delegation`: the agent's delegation contract (`AgentDelegationContract`), declaring which `<delegate>` attributes it accepts. The set is specific to each agent, and a new parameter is added here:
  - `project`: `'required'` or `'optional'`; when absent, the agent receives no project folder;
  - `sessionMode`: `'overridable'`; when absent, the mode is fixed to `defaultSessionMode` and passing the `session` attribute is rejected;
  - `readOnly: true`: the agent never modifies the project, so it can run in parallel with an agent that modifies the same folder; when absent, the agent counts as a writer, and the orchestrator admits only one writer per folder at a time. PRODUCT_OWNER, TECH_LEAD and CODE_REVIEWER are `readOnly`; QA is a writer, since it switches branches, runs the project and changes it locally to test;
  - `artifact`: `'required'` (DEVELOPER, CODE_REVIEWER, QA) or `'optional'` (PRODUCT_OWNER, TECH_LEAD, GIT_OPS); when absent, the agent takes no artifact;
  - `needsReviewableWork: true` (CODE_REVIEWER, QA): the delegated artifact must link a pull request or record a branch;
  - `userInitiatedOnly: true` (IT_SUPPORT): the CEO delegates to the agent only in a turn that answers the user's message or answers; the validator rejects the delegation in a turn that follows an agent result, and the repair prompt sends the CEO to suggest the agent to the user with a `<question>` first. The `agent-team` skill and the `delegation-protocol` skill say so to the CEO;
  - `asksUser: true` (PRODUCT_OWNER, TECH_LEAD, IT_SUPPORT): the agent asks the user directly; the questions of any other delegate are sent back to it, for its result to carry the decision, and the `agent-team` skill tells the CEO which agents ask;
- `artifacts`: the agent's `ArtifactAccess` to the board of its conversation (`constants/artifact-access.constant.ts`): `scope` (`board` for the CEO, `tree` for PRODUCT_OWNER and TECH_LEAD, `task` for DEVELOPER, GIT_OPS, CODE_REVIEWER and QA), `create`, the writable `sections` and the writable `fields`. The orchestrator enforces it on every artifact request, and the board prompts and the `board-requests` skill turn it into the agent's grammar;
- `writesSkills`: when `true` (the CEO), the role lists every skill, reads any of them and writes the user's skills;
- `turnReminder`: optional turn reminder (`string`) appended to the prompt of each of the agent's rounds;
- `systemPromptEveryTurn`: when `true`, the orchestrator prefixes the system prompt to every user message, including in a resumed session. It serves long-session agents, whose context is compacted and loses the prompt sent at session creation; such an agent does without `turnReminder`.

## Where an instruction lives

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

## The board

Every agent writes its deliverable to the board of the conversation, never to a document. From the role's `ArtifactAccess`:

- `buildArtifactProtocolBrief(access)` (`prompts/artifact-protocol.prompt.ts`) writes the board in brief for the system prompt of every executor: what it holds, the round trip, the requests the role uses in most tasks (read, update with its own fields and first section, create when allowed, comment), what it writes, its scope, and the `board-requests` skill for everything else.
- `buildArtifactProtocolReminder(access)` is the reminder line, which also names the `board-requests` skill.
- `buildBoardRequestsBody(access)` (`skills/board-requests.skill.ts`) writes the full protocol, which only skills deliver: the model of the board (features over tasks, one project per feature and its tasks, statuses, refinements, sibling dependencies, sections), the request grammar the role may use (list, read, `tree="true"` for `tree`, create when `create`, update with only its sections and fields, comment) and its rules: the results come back as `<request_results>`, the final answer comes in a response without requests; a `task` agent reads tasks and changes only the task it holds (`[DELEGATED_ARTIFACT]`); an artifact another agent holds is not changed. The `board-requests` skill gives it to every executor role, and the CEO's `artifact-board` skill adds it after the routing.

## Shared prompt blocks

- **Final response**: every agent prompt ends with `FINAL_RESPONSE_INSTRUCTIONS` (`prompts/final-response.prompt.ts`):
  the turn's final response comes exactly once inside `<final_response>…</final_response>`
  (`orchestrator/constants/final-response.constant.ts`), and text outside it is only progress narration. A new agent
  must include this block, because the orchestrator uses the envelope to separate the response from the narration.
  The block also requires every subagent and background task the agent started to have finished, and its result read,
  before the answer, because ending the turn delivers the answer and discards what is still running. Each executor's
  `turnReminder` carries the same rule through `FINAL_RESPONSE_REMINDER`.
- **CWD boundary**: every executor agent includes `CWD_BOUNDARY_INSTRUCTIONS` in its system prompt and
  `CWD_BOUNDARY_REMINDER` in its `turnReminder` (`prompts/cwd-boundary.prompt.ts`). The agent does not read, list or
  change anything outside the CWD unless the received prompt authorizes that exact path and mode (read or write). When
  it needs something from outside, such as an SDK installed on the machine, it stops and returns in its final response
  an access request with path, reason and mode. The CEO evaluates it, asks the user for confirmation when the path
  leaves the workspace, and authorizes it by delegating again to the same role with `session="resume"`. The access
  request is the response to the caller, never a direct question to the user, so that the CEO can assess the risk
  first. GIT_OPS has `$HOME/.ssh` authorized in its own prompt for SSH key setup.
- **Project orientation**: DEVELOPER, TECH_LEAD, CODE_REVIEWER, QA and PRODUCT_OWNER include
  `PROJECT_ORIENTATION_INSTRUCTIONS` in their system prompt and `PROJECT_ORIENTATION_REMINDER` in their `turnReminder`
  (`prompts/project-orientation.prompt.ts`). Before its first action in the project during the session, the agent does
  a quick survey of what the project documents for agents and contributors (`AGENTS.md`, `CLAUDE.md`,
  `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `README.md`, `CONTRIBUTING.md` and the
  nested `AGENTS.md` files in the folders it will touch) and follows their pointers only where they cover the task.
  The survey belongs to the agent itself, not the CEO: the executor's system prompt goes in at ACP session creation, so
  the reading happens once per session and a resumed session already has it; the CEO, with its prompt sent every turn
  and its CWD at the workspaces root, would pay for that context every turn and pass on a lossy summary of the literal
  rules. Each ACP runtime natively loads a different file (CLAUDE.md, AGENTS.md, Copilot instructions), and the
  explicit instruction covers the rest. GIT_OPS does not receive the block: it does not work on the code and also runs
  at the workspaces root.

## Skills on demand

Know-how an agent needs only for some tasks lives in skills instead of its system prompt. The orchestrator sends the
catalog (`[SKILLS]`, the name and description of each skill the role may read, the same explanation for every role and
an extra paragraph on managing skills for a role with `writesSkills`) with the system prompt, and the agent reads a
skill's full content with `<skill_read name="a,b"/>` in its final response when the task calls for it. The description
is all the agent sees before reading, so it says what the skill covers and when to read it.

Every skill is an `AgentSkillDefinition` built when read with the reader's team, board access and the workspaces root.
Built-in skills are `skills/<name>.skill.ts` constants named from `SKILL_NAMES` and listed in `BUILT_IN_SKILLS`; user
skills live in `DATA_DIR/skills/<skill>/SKILL.md` and replace a built-in one of the same name. `AgentSkillsService`
(`IAgentSkillsPort`) merges both per role and validates the CEO's writes. Details:
[references/agent-skills.md](references/agent-skills.md).

## Questions to the user

The CEO, PRODUCT_OWNER, TECH_LEAD and IT_SUPPORT ask the user directly when they need a decision from them to proceed, with
`<question rationale="…">text<option>…</option></question>` tags in their final response. The instructions:

- the guide lives only in the `asking-the-user` skill (`skills/asking-the-user.skill.ts`, for the CEO, PRODUCT_OWNER,
  TECH_LEAD and IT_SUPPORT; its content is in [references/agent-skills.md](references/agent-skills.md));
- `USER_QUESTIONS_BRIEF` (`prompts/user-questions.prompt.ts`): the tag in brief under `### Asking the User` and the
  skill to read before the first question of a session, in the system prompt of PRODUCT_OWNER, TECH_LEAD and IT_SUPPORT;
- `USER_QUESTIONS_REMINDER`: the line included in the `turnReminder` of those agents, which also names the skill.

DEVELOPER and GIT_OPS never ask: a decision only the user can make ends their turn with the decision and its options
in their final answer (their turn reminder says so), and the CEO asks the user and delegates again with the answer
(`delegation-protocol` skill). CODE_REVIEWER and QA do not ask either: they audit or test and return findings, with no
user decision they depend on to finish.

## CEO's lean core prompt

The CEO has no primer: with `systemPromptEveryTurn`, the core prompt accompanies every user message to survive session
compaction. Every line of it costs on every turn and dilutes the rules that matter, so it carries only the hard rules
whose loss breaks the protocol, and the details live in its skills (`delegation-protocol`, `response-protocol`,
`agent-team`, `artifact-board`), which the core names. What the core carries:
[references/ceo-prompt.md](references/ceo-prompt.md).

When adding a rule to the CEO, write at most the sentence that makes it mandatory in the core prompt
and put the details in the topic's skill. Never concatenate into the core prompt an instruction block
shared with the executor agents, such as `USER_QUESTIONS_BRIEF`.

## Who can name whom

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

The prompts live in `packages/server/src/modules/agent-definitions/prompts/`, one `<role>.prompt.ts` per role exporting
its system prompt and its `<ROLE>_TURN_REMINDER` (the CEO exports `buildCeoSystemPrompt(team)` and has no reminder).
Each prompt composes the shared blocks above that apply to the role; what each one prescribes is in the role's
reference file (table under "Functional Roles").

## Registry Service (`AgentRegistryService`)

`AgentRegistryService` implements `IAgentRegistryPort` (`orchestrator/ports/agent-registry.port.ts`): it resolves roles
case-insensitively, builds each prompt with the rest of the team, and gives a generic fallback for an unregistered role.
`registerDefinition` adds or overrides a definition at runtime, and the agent then appears in the CEO's "Your Team".
Every method: [references/registry-service.md](references/registry-service.md).

The `AgentDefinitionsModule` registers `IAgentRegistryPort` with `useExisting: AgentRegistryService`, guaranteeing a
single instance. With `useClass`, definitions registered through the exported class would not reach the orchestrator.
It also binds `IUserSkillStorePort` to `FileUserSkillStoreAdapter` (importing `PathsModule` for `DATA_DIR`) and exports
`IAgentSkillsPort`, bound to `AgentSkillsService`.
