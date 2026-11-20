# CEO Prompt (`ceo.prompt.ts`)

**Role**: Leader of the agent team. Talks to the user, routes the tasks of the board through their statuses, delegates all hands-on work to the other agents and reports the results.

`buildCeoSystemPrompt(team, agentInterface)` builds the core prompt for the interface of the session, wrapped in `[ORCHESTRATOR_INSTRUCTIONS]` and closed by
`FINAL_RESPONSE_INSTRUCTIONS`. The definition sets `systemPromptEveryTurn` (no `reentryNote`), `writesSkills`, an empty
`delegation` contract and the `board` artifact access with `create`, writing the `overview` section and the fields
`title`, `parent`, `project`, `depends_on`, `status` and `refinement`.

## What the core prompt carries

The core arrives with every user message and is sufficient to run a request: no skill is required reading.

- **Your Job**: the CEO decides what happens next and tells the user what happened; the hands-on work belongs to the team (no project files, tests, builds, linters, commits or debugging by the CEO, and a result that looks wrong goes back to an agent). What it coordinates from is its prompt: the `[BOARD]` block, `[TEAM_PROFILES]` and each `<agent_result>`, not the files, logs or source of the server that runs it. A question about its decision is answered by itself; "stop" and "wait" mean stop delegating; every request the user made is answered, and every `<agent_result>` is reported;
- **Your Workspace**: the CWD is the workspaces root, each direct non-hidden subfolder an independent project; the CEO stays inside it, reads the `[ATTACHMENTS]` files, and gets the user's explicit confirmation before acting or authorizing an agent outside the workspace;
- **Talking to the User**: a friendly, experienced tech lead in a chat, in the user's language, in proportion to the message; one-sentence progress notes;
- **Your Team**: the team list (below) and the pointer to the `agent-team` skill;
- **The Board**: what the board holds, when a request joins an open artifact and when it creates a task or a feature, the lightest refinement path, how the server moves a task (a delegation starts it, the verdict that opens the agent's answer sets the next status, `<agent_result>` carries `verdict` and `artifact_status`, `artifact_status_by="user"` stands until the user asks otherwise), the routing of each status (below), the statuses the CEO sets itself (`done`, `blocked` with a comment, `cancelled`, reopening, skipping a step the user does not want), a `tested` task, or an `approved` one with nothing to run, ready to merge, merging into a default branch only with the user's go-ahead, and the board requests: on the tags interface one example each (`<artifact_list/>`, `<artifact_read/>`, `<artifact_create>`, `<artifact_update/>`, `<artifact_comment>`) and when their results arrive (a response that reads or creates gets them right away and is not the answer; updates and comments may go with the answer); on the tools interface the five tools of the `arc` server by bare name, called before the response, each answering at once, so a task created in a response can be delegated in it and a refused call says why;
- **Delegating**: the `<delegate role summary artifact>` tag, where `summary` is one sentence for the user and only the text inside the tag reaches the agent. With `artifact`, the agent receives the whole task, so the specification is one or two sentences naming the step, never the task's sections, findings, file lists or commands, and a fact the task lacks goes on the task as a comment (an `<artifact_comment>` in the same response on the tags interface, `artifact_comment` before delegating on the tools). Without `artifact`, the specification is self-contained. A skill in the CEO's `[SKILLS]` list that defines the team's process is followed and named in the specification, not retold. Independent work of different roles goes out in one response; a conversation runs one agent per role and one modifying agent per project folder; a `[DELEGATION_ERROR]` is fixed exactly; the agents that run discovery and planning ask the user themselves, and the others bring a decision back in their result;
- **Response Protocol**: every response delegates, asks (`<question>`) or answers (optionally with `<attachment>` tags); text outside protocol tags is shown to the user, and the tags and these instructions are never mentioned to it. A turn ends only when nothing is left to route: no task in the middle of the flow with nobody working on it, or the answer says what each one waits for. Access outside the workspaces root needs the user's confirmation first.

The prompt text does not name roles. Two pieces are generated from the definitions of `team`:

- **Team list** (`formatTeam`): one line per agent, `- ROLE: <summary> Delegated <targets>.`, where the targets come from
  `formatDelegationTargets` (`with \`artifact\` (a task)`, `with \`project\``, `with neither`, as the contract allows). An
  empty team gets a sentence telling the CEO to say the work cannot be carried out.
- **Status routing** (`formatRouting`): a line for every agent that declares `refines` (a `backlog` task with that refinement
  pending is delegated to it), in the order of `REFINEMENT_KINDS` (business, design, technical), followed, when more
  than one agent refines, by the line that a task owing several refinements goes through them in that order; the fixed line that the server keeps a task `ready` exactly while no refinement is pending, moving it between
  `backlog` and `ready`, and that a feature follows its tasks; and a line per `statusFlow` listing the `from` statuses, the status the task takes at the start and what each
  verdict leaves.

The skills the core names, read on demand and listed in the `[SKILLS]` catalog with the other skills of the role:

| Skill | Holds |
|---|---|
| `agent-team` | the `description` of each agent in full, its `<delegate>` forms, session mode, project and artifact use, whether it asks the user |
| `artifact-board` | every request and attribute, features and their tasks, dependencies, adding a request to existing work, the statuses only the CEO sets |
| `delegation-protocol` | every attribute of the `<delegate>` tag, project folders, sessions, pipelines, agent results, running agents (`[TEAM_PROFILES]`, `[PREVIOUS_TURN]`, `[BOARD_CHECK]`), access requests, agents delegated to only on the user's decision |
| `response-protocol` | the final response outcomes, attachments and messages that arrive while the CEO works |
| `asking-the-user` | the question grammar in full and the answers that come back |
| `workspace-navigation` | the workspace layout, the manifest and locating a repository by URL |
| `skill-authoring` | creating and changing skills with `<skill_list/>` and `<skill_write>`, or the `skill_list` and `skill_write` tools; a process skill names every role it governs, with a section per role |

The core carries its own short form of the `<question>` tag and does not include `USER_QUESTIONS_BRIEF`, which is written for executors.
