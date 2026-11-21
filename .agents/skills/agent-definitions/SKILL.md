---
name: agent-definitions
description: >
  Standard for defining and registering AI agent personas: the AgentRole roles, the AgentDefinition contract with its
  delegation contract (artifact, refinement and status flow with verdicts), the system prompt and re-entry note of each
  role, the built-in skills agents read on demand and the user's own in DATA_DIR/skills, the CEO's self-sufficient core
  prompt, and AgentRegistryService (IAgentRegistryPort). Use when creating, modifying or looking up agent personas,
  roles, verdicts, prompts or agent skills.
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
development agents. The orchestrator module owns the mechanics that act on a definition (turns, delegation validation,
statuses, sessions); this module owns what a definition declares and what each prompt and skill tells the agent.

## Reference files

- [references/agent-skills.md](references/agent-skills.md): the built-in skills per role, the user skill store and
  the validation of skill writes. Read it when adding a skill or changing how skills are stored or merged.
- [references/registry-service.md](references/registry-service.md): every `AgentRegistryService` method and its
  fallback for an unknown role. Read it when changing the registry or the `IAgentRegistryPort` contract.
- [references/ceo-prompt.md](references/ceo-prompt.md): the CEO's core prompt, the team list and status routing
  generated from the definitions, and the skills it names.
- One file per executor role (below) with what its prompt prescribes, its contract and its board access. Read the one
  of the role you are creating, changing or routing to.

## Functional Roles (`AgentRole`)

```typescript
export type AgentRole =
  | 'CEO'
  | 'GIT_OPS'
  | 'DEVELOPER'
  | 'CODE_REVIEWER'
  | 'TECH_LEAD'
  | 'PRODUCT_OWNER'
  | 'UX_DESIGNER'
  | 'QA'
  | 'IT_SUPPORT';
```

| Role | Summary | Prompt reference |
|---|---|---|
| `CEO` | Leads the team: talks to the user, triages, routes the board's tasks through their statuses, delegates all hands-on work and reports the results. | [ceo-prompt.md](references/ceo-prompt.md) |
| `PRODUCT_OWNER` | Product discovery with the user before technical planning; writes the business sections of a feature and its tasks. | [product-owner-prompt.md](references/product-owner-prompt.md) |
| `UX_DESIGNER` | Expert UX/UI design after the business refinement and before technical planning: visual direction, tokens, screens, flows and every state, proven in a working prototype on a never-merged `design/<artifact id>-<slug>` branch; writes the `ux_design` section and settles the design refinement. | [ux-designer-prompt.md](references/ux-designer-prompt.md) |
| `TECH_LEAD` | Technical planning and investigation; writes each task's technical solution and splits large work. | [tech-lead-prompt.md](references/tech-lead-prompt.md) |
| `DEVELOPER` | Works one task end to end on a branch of its own: code, tests, commits, push and its pull request; DONE or INCOMPLETE. | [developer-prompt.md](references/developer-prompt.md) |
| `CODE_REVIEWER` | Independent review of a task's pull request or branch without running it; APPROVED or CHANGES_REQUESTED. | [code-reviewer-prompt.md](references/code-reviewer-prompt.md) |
| `QA` | Tests a reviewed task by running the application, preparing its own environment with local changes it never commits; PASSED, FAILED or BLOCKED. | [qa-prompt.md](references/qa-prompt.md) |
| `GIT_OPS` | Repository administration: adds repositories to the workspace, syncs and merges branches, merges pull requests, runs destructive operations on explicit instruction, sets up SSH; sole writer of `workspace-manifest.json`. | [git-ops-prompt.md](references/git-ops-prompt.md) |
| `IT_SUPPORT` | Environment and system administration of the machine: investigates read-only, asks the user to approve a plain-language plan and changes nothing before the approval. The CEO only suggests it. | [it-support-prompt.md](references/it-support-prompt.md) |

## Definition Contract (`AgentDefinition`)

- `role`: the agent's role, restricted to the `AgentRole` union;
- `name`: human-readable label for the agent;
- `summary`: required, one sentence for the team list of the CEO prompt;
- `description`: the full entry of the agent in the `agent-team` skill's catalog: what it does, what it expects and what it answers, so that it says when to delegate to the agent;
- `buildSystemPrompt(team, agentInterface)`: builds the agent's prompt for the interface of its session (below). Receives `team`, the other registered definitions, so that the CEO can list them. Executor agents ignore `team`;
- `defaultModel`: optional default language model associated with the persona;
- `defaultSessionMode`: default session mode of a delegation without an artifact (`'resume' | 'new'`); the registry falls back to `'resume'`, so a definition declares it only for `'new'`, and none of the initial ones does. A delegation with an artifact always runs in the role's session for that task, so a role with `artifact: 'required'` declares neither this nor `sessionMode`;
- `delegation`: the `DelegationContract` of `orchestrator/ports/agent-registry.port.ts`, declaring which `<delegate>` attributes the agent accepts and how a delegation moves the task. A new parameter is added there:
  - `project`: `'required'` or `'optional'`; when absent, the agent receives no project folder;
  - `sessionMode`: `'overridable'`; when absent, the mode of a delegation without an artifact is fixed to `defaultSessionMode` and passing the `session` attribute there is rejected (with an artifact, `session` is accepted and ignored);
  - `readOnly: true`: the agent never modifies the project, so it can run in parallel with an agent that modifies the same folder; when absent, the agent counts as a writer. PRODUCT_OWNER, TECH_LEAD and CODE_REVIEWER are `readOnly`; QA is a writer, since it switches branches, runs the project and changes it locally to test, and so is UX_DESIGNER, which commits its prototype on a branch of its own;
  - `artifact`: `'required'` (DEVELOPER, CODE_REVIEWER, QA) or `'optional'` (PRODUCT_OWNER, UX_DESIGNER, TECH_LEAD, GIT_OPS); when absent, the agent takes no artifact;
  - `needsReviewableWork: true` (CODE_REVIEWER, QA): the delegated artifact must link a pull request or record a branch;
  - `asksUser: true` (PRODUCT_OWNER, UX_DESIGNER, TECH_LEAD, IT_SUPPORT): the agent asks the user directly; without it, a decision the agent needs comes back in its result;
  - `userInitiatedOnly: true` (IT_SUPPORT): the CEO delegates to the agent only in a turn that answers the user's message or answers, after suggesting it to the user with a `<question>`;
  - `refines`: a `RefinementKind` of the artifacts module's `REFINEMENT_KINDS`, the refinement the role settles on the artifacts it is delegated: `'business'` (PRODUCT_OWNER), `'design'` (UX_DESIGNER) or `'technical'` (TECH_LEAD), one role per kind;
  - `statusFlow`: how a delegation moves the status of its task (below); absent, a delegation leaves the status alone;
- `artifacts`: the agent's `ArtifactAccess` to the board of its conversation (`constants/artifact-access.constant.ts`): `scope` (`board` for the CEO, `tree` for PRODUCT_OWNER, UX_DESIGNER and TECH_LEAD, `task` for the others), `create`, the writable `sections` and the writable `fields` (`title`, `parent`, `project`, `depends_on`, `status`, `refinement`, `branch`, `pull_requests`). DEVELOPER and GIT_OPS write `branch` and `pull_requests`; the board prompts and the `board-requests` skill turn the access into the agent's grammar;
- `writesSkills`: when `true` (the CEO), the role lists every skill, reads any of them and writes the user's skills;
- `buildReentryNote(agentInterface)`: optional note put before the prompt that resumes a session the agent already has, never in a new or live session (written with the `buildReentryNote` of `prompts/reentry-note.prompt.ts`, below);
- `systemPromptEveryTurn`: when `true` (the CEO), the system prompt accompanies every user message, so the agent does without a re-entry note.

### Status flow and verdicts

`statusFlow` has `from` (the statuses a task may be in when delegated to the role), `start` (the status the task takes when the agent starts, one of `from`) and `verdicts` (the status each verdict word leaves it in). The verdict is the first non-empty line of the agent's final answer: the word alone, written in English exactly as the prompt shows it, case included, whatever the user's language, since the server matches the keys of `verdicts` literally (`DelegationStatusService.findVerdict` only takes off Markdown decoration, a `Verdict:` label and closing punctuation). A line that goes on after the word (`DONE: pushed`, `Passed 4 of 6 tests`) is no verdict, which leaves the status for the CEO to decide; the CEO prompt's routing is generated from these declarations.

| Role | `from` | `start` | Verdicts |
|---|---|---|---|
| `DEVELOPER` | `ready`, `in_progress`, `changes_requested` | `in_progress` | `DONE` → `in_review`, `INCOMPLETE` → `in_progress` |
| `CODE_REVIEWER` | `in_review` | none | `APPROVED` → `approved`, `CHANGES_REQUESTED` → `changes_requested` |
| `QA` | `approved`, `in_testing` | `in_testing` | `PASSED` → `tested`, `FAILED` → `changes_requested`, `BLOCKED` → `in_testing` |

A `tested` task, like an `approved` one with nothing to run, waits for the merge, which the CEO's core prompt states. An executor with a verdict opens its final answer with the word on a line of its own, written exactly as shown (its system prompt and re-entry note say so, and so does the `[USER_LANGUAGE]` block of every delegated prompt), followed by a short receipt. Its report lives on the task (`implementation_notes`, `review_findings`, `test_report`): on the tags interface an artifact request in the same final response as the answer writes it, on the tools interface an `artifact_update` call before the answer. PRODUCT_OWNER, UX_DESIGNER and TECH_LEAD declare `refines`; the roles without a status flow (GIT_OPS, IT_SUPPORT) leave the status of their task to the CEO.

## Two interfaces

An agent session reaches the board and the skills on one of two interfaces (`AgentInterface`,
`orchestrator/models/agent-interface.model.ts`): `tools`, when the orchestrator attached the `arc` MCP server to the
session, or `tags`, the requests written in the final response. The orchestrator decides it per session and passes it to
every text of this module: `buildSystemPrompt`, `buildReentryNote`, `SkillContext.agentInterface` and so the
`role-guide` skill.

- The tags variant of each prompt and skill is the protocol of the requests, with their grammar and the rule that their
  results come back in the next prompt.
- The tools variant names each tool by its bare name (`artifact_update`) and the server once where the tools are
  introduced, since every CLI shows a tool under its own prefixed name. A call answers at once, so it teaches recording
  on the task before the final answer, using the id a creation returns, and fixing a refused call before the next one.
  The schemas carry the grammar, so it holds no attribute list or XML example, and it is never longer than the tags
  variant.
- Both variants share every passage that does not depend on the interface; only the passages about the board and the
  skill requests differ, written as a `Record<AgentInterface, string>` beside the prompt. The final answer, its verdict
  word, `<question>`, `<delegate>` and `<attachment>` are tags on both.
- The re-entry note of the tools interface names the tools plainly, since the session may have started on the tags
  before the tools existed. The tags it remembers still work.

## Where an instruction lives

Every instruction sits in one of four layers, chosen so that context stays small and the information is there when
the agent needs it:

1. **Core** (the system prompt): what the role uses in nearly every task. The executors get it once per session, and
   again in a resumed session whose recorded copy differs from the current one (the session binding keeps a hash of the
   text it was sent); the CEO with every user message, so its core is written to be sufficient for a request without reading a skill.
2. **Re-entry note** (`buildReentryNote`): the rules nothing else enforces, for a prompt that reaches a session the agent
   already has, ending with the pointer to the `role-guide` skill. It is built by `buildReentryNote(roleName, rules, agentInterface)`
   (`prompts/reentry-note.prompt.ts`): a `[RE-ENTRY]` header, on the tools interface the tools of the `arc` server, the role's rules and the rule to finish only after every
   subagent and background task has ended, with the final answer inside the `<final_response>` envelope. The
   orchestrator decides when it is sent.
3. **Skills** (read on demand): full grammars, guides and edge cases, listed by the `[SKILLS]` catalog. The
   `role-guide` skill returns the role's full system prompt (`SkillContext.rolePrompt`) to a session that lost it.
4. **Server validation**: every request and delegation is checked; an error comes back with its reason, so an agent
   that forgot a detail gets it back.

## The board

Every agent writes its deliverable to the board of the conversation, never to a document. From the role's `ArtifactAccess`:

- `buildArtifactProtocolBrief(access, agentInterface)` (`prompts/artifact-protocol.prompt.ts`) writes the board in brief for the system prompt of every executor: what it holds, the requests the role uses in most tasks (read, update with its own fields and first section, create when allowed, comment), when the requests are carried out, what it writes, its scope, and the `board-requests` skill for everything else. On the tags interface updates and comments go in the same final response as the final answer, and a response that reads or creates gets its results first (a creation's id is something the agent must read), with the final answer whole after them; on the tools interface the agent writes to the board before its final answer and corrects a refused call before going on. A role that creates writes the `overview` of what it creates, even when `overview` is not among its sections.
- `buildBoardRequestsBody(access, agentInterface)` (`skills/board-requests.skill.ts`) writes the full protocol, which only skills deliver: the model of the board (features over tasks, one project per feature and its tasks, statuses, refinements, sibling dependencies, sections), the request grammar the role may use (list, read, `tree="true"` for `tree`, create when `create`, update with only its sections and fields, comment), or on the tools interface what each of its tools is for, and its rules. A `task` agent reads tasks and changes only the task it holds (`[DELEGATED_ARTIFACT]`); an artifact another agent holds is not changed. The `board-requests` skill gives it to every executor role, and the CEO's `artifact-board` skill adds it after the routing.
- The `status` attribute of an update reminds the writer that the server sets the status a delegation or a verdict leaves, so a status is set only for a decision.

## Shared prompt blocks

- **Final response**: every agent prompt ends with `FINAL_RESPONSE_INSTRUCTIONS` (`prompts/final-response.prompt.ts`):
  the turn has exactly one `<final_response>…</final_response>` block
  (`orchestrator/constants/final-response.constant.ts`), the last thing of the turn: text before it is progress
  narration and text after it is discarded. A response with more than one block is answered again
  (`buildFinalResponseCountRepairPrompt`). A new agent must include this block, because the orchestrator uses the
  envelope to separate the response from the narration.
  The block also requires every subagent and background task the agent started to have finished, and its result read,
  before the answer, because ending the turn delivers the answer and discards what is still running.
- **CWD boundary**: every executor agent but IT_SUPPORT includes `CWD_BOUNDARY_INSTRUCTIONS`
  (`prompts/cwd-boundary.prompt.ts`) in its system prompt. The agent does not read, list, search or change anything
  outside the CWD unless the received prompt authorizes that exact path and mode (read or write); project commands may
  use tool caches on their own. When it needs something from outside, such as an SDK installed on the machine, it
  stops and returns in its final response an access request with path, reason and mode. The request is the response to
  the caller, never a direct question to the user, so that the CEO can assess the risk first. GIT_OPS has `$HOME/.ssh`
  authorized in its own prompt for SSH key setup.
- **Project orientation**: DEVELOPER, TECH_LEAD, CODE_REVIEWER, QA, PRODUCT_OWNER and UX_DESIGNER include
  `PROJECT_ORIENTATION_INSTRUCTIONS` (`prompts/project-orientation.prompt.ts`). Before its first action on a project
  in a session, the agent reads the guidance the project keeps at its root that is not in its context yet (`AGENTS.md`,
  `CLAUDE.md`, `.github/copilot-instructions.md`, `README.md`, `CONTRIBUTING.md`) and the `AGENTS.md` files inside the
  folders it will touch, and follows their pointers where they cover the task. The survey belongs to the executor, not
  the CEO: the executor's system prompt goes in once per session, so the reading happens once, while the CEO, with its
  prompt sent every turn and its CWD at the workspaces root, would pay for that context every turn and pass on a lossy
  summary of the literal rules. GIT_OPS and IT_SUPPORT do not receive the block: they do not work on the project's code.

## Skills on demand

Know-how an agent needs only for some tasks lives in skills, outside its system prompt. The orchestrator sends the
catalog (`[SKILLS]`, the name and description of each skill the role may read) with the system prompt and again after the
re-entry note of a resumed session whose system prompt is unchanged. A skill created since a session's system prompt changes the text it would be sent (the catalog is part of it), so that session gets the system prompt again, with the current catalog. The agent
reads a skill's full content when the task calls for it: with `<skill_read name="a,b"/>` in its final response, or the
`skill_read` tool on the tools interface. The
description is all the agent sees before reading, so it says what the skill covers and when to read it.

Every skill is an `AgentSkillDefinition` built when read from a `SkillContext` (the reader's team, board access and
system prompt, the interface of its session, and the workspaces root). Built-in skills are `skills/<name>.skill.ts` constants named from
`SKILL_NAMES` and listed in `BUILT_IN_SKILLS`; user skills live in `DATA_DIR/skills/<skill>/SKILL.md` and replace a
built-in one of the same name. `AgentSkillsService` (`IAgentSkillsPort`) merges both per role and validates the CEO's
writes. Which role reads which skill, and the details: [references/agent-skills.md](references/agent-skills.md).

Every executor but IT_SUPPORT reads `board-requests`; every executor reads `role-guide`. The procedures a role needs only
sometimes are skills of that role: `git-remote` (DEVELOPER, GIT_OPS), `repository-setup` (GIT_OPS),
`review-publishing` (CODE_REVIEWER), `running-checks` (DEVELOPER, CODE_REVIEWER, QA), the testing skills (QA),
`running-the-app` (QA, UX_DESIGNER), the design skills (UX_DESIGNER, four of them also DEVELOPER).

## Questions to the user

The CEO, PRODUCT_OWNER, UX_DESIGNER, TECH_LEAD and IT_SUPPORT ask the user directly when they need a decision from them to proceed, with
`<question rationale="…">text<option>…</option></question>` tags in their final response. The instructions:

- `USER_QUESTIONS_BRIEF` (`prompts/user-questions.prompt.ts`): the essentials under `### Asking the User`, in the
  system prompt of PRODUCT_OWNER, UX_DESIGNER, TECH_LEAD and IT_SUPPORT: the tag with its `rationale`, context in the text outside
  the tags, one option per plausible answer and no "Other", the recommended option first and assumed on a timeout,
  facts looked up, never asked, and the decisions mapped before the first round so that each response asks the
  whole frontier (every decision whose prerequisites are settled) while dependent ones wait;
- the `asking-the-user` skill (`skills/asking-the-user.skill.ts`, for the CEO, PRODUCT_OWNER, UX_DESIGNER, TECH_LEAD
  and IT_SUPPORT) covers the rest: keeping the decision map across rounds, ending an interview with an empty frontier and
  a confirmed summary, attachments in the answers and timed-out answers. The brief names it. The role prompts say,
  in their own terms, what a fact is and what the reason of a recommendation is, and when the summary is confirmed.
  The CEO's core carries its own short version of the tag.

DEVELOPER and GIT_OPS never ask: a decision only the user can make ends their turn with the decision and its options
in their final answer, and the CEO asks the user and delegates again with the answer. CODE_REVIEWER and QA do not ask
either: they audit or test and return findings, with no user decision they depend on to finish.

## CEO's core prompt

The core prompt is self-sufficient: it carries the team list, the status routing, the request brief, the delegation
rules and the response protocol, and arrives with every user message. Its skills (`agent-team`, `artifact-board`,
`delegation-protocol`, `response-protocol`, plus `workspace-navigation`, `skill-authoring` and `asking-the-user`) are
on-demand references for attributes and edge cases, and none of them is required reading. What the core carries and how
it is generated: [references/ceo-prompt.md](references/ceo-prompt.md).

A rule the CEO needs to route a request belongs in the core, generated from the definitions when it depends on the team;
a detail needed only occasionally belongs in a skill. Never concatenate into the core an instruction block shared with
the executor agents, such as `USER_QUESTIONS_BRIEF`.

## Who can name whom

An executor agent's prompt describes only itself. It receives `team` in `buildSystemPrompt(team)` and ignores it, so it
has no team section, and naming another role inside it creates a reference to something the agent does not know. Its
prompt refers to the others by function ("a reviewer with no memory of this session", "another agent"), and scope limits
are written about the agent itself, never pointing to the role that takes over the task.

Only the CEO's prompt sees the team, and even there the knowledge about each agent lives in the definition: `summary`
and the delegation targets in the team list, `refines` and `statusFlow` in the routing, `description` in the
`agent-team` skill. The CEO's prompt text does not mention roles: a new agent gets routed by declaring its own
definition, without editing the CEO's prompt.

## Specialized System Prompts

The prompts live in `packages/server/src/modules/agent-definitions/prompts/`, one `<role>.prompt.ts` per role exporting
`build<Role>SystemPrompt(agentInterface)` and `build<Role>ReentryNote(agentInterface)` (the CEO exports
`buildCeoSystemPrompt(team, agentInterface)` and has no note; IT_SUPPORT, which works off the board, exports one
`IT_SUPPORT_SYSTEM_PROMPT` for both interfaces). Each prompt composes the shared blocks above that apply to the role; what each one prescribes is in the role's
reference file (table under "Functional Roles").

## Registry Service (`AgentRegistryService`)

`AgentRegistryService` implements `IAgentRegistryPort` (`orchestrator/ports/agent-registry.port.ts`): it resolves roles
case-insensitively, builds each prompt with the rest of the team, and gives a generic fallback for an unregistered role.
`registerDefinition` adds or overrides a definition at runtime, and the agent then appears in the CEO's team list.
Every method: [references/registry-service.md](references/registry-service.md).

The `AgentDefinitionsModule` registers `IAgentRegistryPort` with `useExisting: AgentRegistryService`, guaranteeing a
single instance. With `useClass`, definitions registered through the exported class would not reach the orchestrator.
It also binds `IUserSkillStorePort` to `FileUserSkillStoreAdapter` (importing `PathsModule` for `DATA_DIR` and
`StorageModule` for its locks) and exports
`IAgentSkillsPort`, bound to `AgentSkillsService`.

## Constants

- `constants/skill-names.constant.ts`: `SKILL_NAMES`, the one place a prompt or a skill takes a skill's name from.
- `constants/workspace-manifest.constant.ts`: `WORKSPACE_MANIFEST_FILE`, the name of the file at the workspaces root that maps repository URLs to project folders.
- `constants/artifact-access.constant.ts`: the `ArtifactAccess` of each role.
- `utils/team-format.util.ts`: `formatDelegationTargets` (what a delegation to the agent names, for the team list) and `formatDelegationForms` (the full `<delegate>` tag forms, for the `agent-team` skill).
