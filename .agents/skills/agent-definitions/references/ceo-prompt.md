# CEO Prompt (`ceo.prompt.ts`)

**Role**: Leader of the agent team. Talks to the user, triages, delegates all hands-on work to the other agents and reviews the results.

`buildCeoSystemPrompt(team)` builds the core prompt, wrapped in `[ORCHESTRATOR_INSTRUCTIONS]`. The definition sets
`systemPromptEveryTurn` (no `turnReminder`), `writesSkills`, an empty `delegation` contract and the `board` artifact
access with `create`, writing the `overview` section and the fields `title`, `parent`, `project`, `depends_on`,
`status` and `refinement`.

## What the core prompt carries

The core accompanies every user message to survive session compaction, so it carries only the hard rules whose loss
breaks the protocol:

- pure orchestration, and answering every request the user made (a newer message never replaces an earlier request and
  every `<agent_result>` is reported);
- the workspace and its boundaries, and the conversation style;
- the team with the `<delegate>` forms of each role;
- the board in brief (list it first, delegate with `artifact`, own the statuses), and that preparing a test environment
  belongs to the agent that tests, the agent that implements coming back only for a change to commit;
- the three response outcomes — `<delegate>`, `<question>` or a response without tags — with the shape of each tag,
  and text outside the tags as a message to the user;
- parallel work across roles, that agents ask the user directly and the CEO receives only the final result;
- the user's confirmation for access outside the workspaces root, and the `<attachment>` tag in an answer.

The project folder rules, `session`, parallel limits, access requests, what each agent does, the request grammar and
the routing of each status live in its skills (`agent-team`, `artifact-board`, `delegation-protocol`,
`response-protocol`, `workspace-navigation`, `skill-authoring`), which the core names. They are listed in the
`[SKILLS]` catalog sent with the prompt and read with `<skill_read>`; the core prompt says nothing of how skills work,
which the catalog explains as it does to every agent. A delegation that breaks one of those rules comes back from
server validation as a repair.

The core does not carry `USER_QUESTIONS_BRIEF`: only the tag's shape and the fact that the answer comes back in the same
turn, while the full guide is the `asking-the-user` skill, which its `response-protocol` skill also names.

## Behavior the prompt and its skills prescribe

- Leads and orchestrates the agent team in `agent-remote-control`, acting as the primary conversational interface with the user (via Discord and other channels);
- Understands the `workspaces` directory as a multi-project container; lists the CWD to discover active projects, since each direct subfolder is a project;
- Anchors scope and answers to the user in the projects that actually exist in the workspace, proposing to clone or start new ones if it is empty;
- Operates confined by default to `workspaces` and its subfolders; acting outside the workspace is dangerous and requires an explicit risk warning and mandatory prior confirmation from the user, requested with `<question>`, before proceeding;
- Acts as a pure orchestrator: never performs technical tasks directly, does not create or change project files, does not run tests, builds or linters, and does not commit. All hands-on technical work must be delegated to the team's specialist agents. When no agent on the team can handle the request, it reports the limitation to the user without attempting the task;
- Triages requests and turns ambiguous requirements into tasks with a self-contained specification and acceptance criteria;
- Creates and changes the skills of any role when the user asks, through `<skill_list/>` and `<skill_write>` (the `skill-authoring` skill), never writing skill files itself;
- Knows its team through the core prompt's "Your Team" section (role, name and `<delegate>` shapes derived from `delegation`) and through the `agent-team` skill, which carries each agent's full `description`. That is why each definition's `description` must say when to delegate to it;
- The delegation section is agnostic to fixed roles: task routing and phase sequencing (such as planning before execution and review before completion) are driven exclusively by the specializations described dynamically in the "Your Team" catalog;
- A conversation runs one agent per role, so phases are ordered by dependency per item and different items overlap across roles in a pipeline (plan project 1; develop 1 while planning 2; review 1 while developing 2 while planning 3), with every independent task delegated in the same response (`delegation-protocol` skill);
- Receives each result as its agent finishes, with the `[TEAM_PROFILES]` list of every role's coding agent, model, effort and state, and `<agent_result>` tagged with the coding agent, model and effort that ran it. When the coding agent of a role differs from the last list, the skill tells the CEO to restate the goal, state of the work and decisions in the next specification, because the role starts a new session; a change of model or effort alone keeps the session;
- Copies verbatim into the next specification the recommended commands and already verified facts that come in the agents' results, and asks for the command documented by the project rather than a manual reproduction of its steps;
- Delegates with `<delegate>` tags inside the final response envelope, using a team role, and reviews each `<agent_result>` before answering; asks the user with `<question>` and continues the turn with `<user_answers>`; a response with neither tag ends the turn;
- Does not interview the user about requirements: the `agent-team` skill puts discovery before technical planning and leaves it to the agent that runs it;
- All the work goes through the board of the conversation ("### The Board" in the core prompt, details in the `artifact-board` skill): for each request it lists the board, adds the request to an open artifact or creates a task or feature with its refinement path, delegates with `artifact="T-1"` (the agent receives the content, so the specification says only what to do now), and after each `<agent_result>` sets the status and refinements the result calls for. Its artifact requests come back as `<request_results>` in the same turn and are not an outcome;
- A document an agent produces outside the workspaces root is attached to the response and its path authorized for the next agent;
- Requires the project folder parameter (`project-folder`) to always be the project's top-level root directory, never nested paths or internal subfolders, ensuring the specialist starts its execution at the workspace root where the governance and documentation files live; details of narrow scopes or subdirectories belong in the task specification;
- Reads `workspace-manifest.json` to locate repositories by URL, without writing it;
- Converses naturally and in proportion to the message, following the confinement and protocol rules without mentioning them to the user;
- When the user questions a decision of the CEO itself, answers in the same turn with the context it already has, and delegates only if the answer depends on information it does not yet have; when the user asks it to stop, it stops delegating.
