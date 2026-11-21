---
name: artifacts
description: >
  Board of features and tasks of each conversation: the artifacts module, the IArtifactsPort and its rules
  (two levels, projects of features and tasks, dependencies, statuses, refinements, one holder per artifact, history),
  the board tables of the SQLite store, and how agents read and write the board with artifact requests
  (<artifact_list>, <artifact_read>, <artifact_create>, <artifact_update>, <artifact_comment>) under the access
  of their role. Use when working with tasks, features, the board, artifact delegation or artifact permissions.
---

# Artifacts (the board)

> **Maintaining this skill**
>
> Update this document whenever any rule described here changes. The criterion is not
> *which* rule — it is the nature of the change: a board invariant, port contract, request grammar or
> access rule changed → update; a technical refactor that preserves the described behavior → leave it alone.

`packages/server/src/modules/artifacts/` keeps the board; the orchestrator lets agents use it through their
responses, and every channel (web today, Discord later) reads and changes it through the same port.

## Model

- **A conversation is a mission and keeps its own board.** Ids repeat across conversations (`F-1`, `T-1`), so
  every port method takes the `conversationId` first.
- **Two levels.** `feature` (prefix `F`) groups the tasks of one initiative and is always a root. `task`
  (prefix `T`) is the unit one agent works on, under a feature or standalone. Ids are allocated per type and
  conversation and never reused (`ARTIFACT_ID_PREFIXES`, `ARTIFACT_PARENT_TYPES` in `constants/artifact-catalog.constant.ts`).
- **Projects.** A project is an existing direct folder of the workspace root (`IWorkspacePort.listProjectFolders`).
  A **feature** links one or more (`projectNames`, at least one, no repeats, in the order given) and its `projectName` is
  `null`. A **task** works in exactly one (`projectName`; `projectNames` is that project as a one-item list, so a
  consumer reads one field for both types). A task under a feature names one of the feature's projects: left out, the
  project is the feature's only one, and a feature with several refuses the creation naming them (`ArtifactRulesService.defaultTaskProject`, `checkTaskProject`). A standalone task names its
  own. A task changes project or feature only within its feature's projects (`checkProjectOfFeature`), and the
  `projectNames` of a feature (replaced as a whole) cannot leave out a project one of its tasks works in
  (`checkFeatureProjects`). `ArtifactChanges.projectName` is for tasks and `projectNames` for features, the other
  combination is refused, except that a feature created with `projectName` alone links that one project. The board
  filter `projectName` matches a feature that links the project and a task that works in it. The history records
  `project` for a task (`from`/`to` the project) and `projects` for a feature (`from`/`to` the lists joined by `, `).
- **Pull requests** carry `repository`, the path of the git repository relative to the task's project folder (`.`, the
  default, is the project folder itself; `repositories/api` is a nested clone), so a task that changes several
  repositories of its project has one pull request each. The path is normalized (`./api/` is `api`, empty is `.`) and
  cannot be absolute or climb out with `..` (`checkPullRequestRepository`). `branch` stays one name for the whole
  task. A link is keyed by its URL, and an update without `repository` keeps the stored one.
- **Dependencies link siblings** (`ArtifactRulesService.checkDependencies`): a feature depends on other features, a
  task on other tasks of its feature, a standalone task on other standalone tasks; no cycles. A task moves to another
  feature (or out of one) only when no sibling it leaves behind depends on it (`checkDependents`), and its own
  dependencies must fit the new place. Listings show the dependencies still open as `waiting on`.
- **Fields**: `title`, `status` (`backlog`, `ready`, `in_progress`, `in_review`, `changes_requested`, `approved`,
  `in_testing`, `tested`, `done`, `blocked`, `frozen`, `cancelled`; `done` and `cancelled` are closed; `tested` is a task
  that passed its practical test and waits for the merge), `refinement` (one state per kind of `REFINEMENT_KINDS`:
  `business`, `design`, `technical`, each `pending`, `done` or `skipped`), `dependsOn`, `assignee`, `branch`,
  `pullRequests` (`url`, `title?`, `repository`, `state` `open|merged|closed`, upserted by URL), `sections` and `history`.
- **Sections** (`ARTIFACT_SECTIONS`, titles in `ARTIFACT_SECTION_TITLES`): `overview`, `user_stories`, `scope`,
  `business_rules`, `flows`, `acceptance_criteria`, `test_cases`, `glossary`, `pending_decisions`,
  `open_questions`, `ux_design`, `technical_solution`, `implementation_notes`, `review_findings`, `test_report`. A section is Markdown; an
  empty one is absent. `ux_design` holds the design of the work: the prototype branch and how to open it, the screens,
  states and design decisions. `review_findings` holds the verdict and findings of the last review, whether of a pull request or of
  the task's branch reviewed locally, and `test_report` the verdict and results of the last practical test (QA), so whoever
  fixes the task finds them there.
- **Creation**: a task that owes no refinement starts `ready` (a simple task straight to development); anything
  else starts in the `backlog`. A refinement left out takes its `DEFAULT_REFINEMENT_STATES` entry.
- **Refinement kinds**: every rule, request attribute, tool property, prompt and channel iterates `REFINEMENT_KINDS`
  (the protocol exports the same list, checked by `artifact-catalog.constant.spec.ts`), so a new kind is added there, in
  `DEFAULT_REFINEMENT_STATES` and in the protocol only. `DEFAULT_REFINEMENT_STATES` is the state of a refinement nobody
  gave, left out of a creation or missing from an artifact stored before its kind existed: `business` and `technical`
  are owed (`pending`), and `design` is `skipped`, so only work that asks for a design owes one.
- **Derived statuses** (`ArtifactRulesService.derivedTaskStatus` and `derivedFeatureStatus`, applied by
  `ArtifactDerivationService` inside the transaction of the change, as `system` history events that say why, and
  published like any saved artifact):
  - A task is `ready` exactly while no refinement is `pending`: one left in `backlog` with none pending becomes `ready`
    ("Ready: no refinement is pending"), and a `ready` one whose refinement goes back to `pending` returns to `backlog`
    ("Back to the backlog: a refinement is pending"). Every other status is left alone, so a refined task is parked with
    `blocked`, never with `backlog`.
  - A feature becomes `in_progress` when one of its tasks is active (`in_progress`, `in_review`, `changes_requested`,
    `approved`, `in_testing`, `tested`, `ACTIVE_TASK_STATUSES`) or `done`, another is still open and the feature is `backlog`,
    `ready` or `done`; it becomes `done` when every task is `done` or `cancelled`, at least one is `done` and the
    feature is `backlog`, `ready` or `in_progress`.
  - `blocked`, `frozen` and `cancelled` features, features without tasks and the status a user gives a feature are left
    alone: the feature is settled when one of its tasks is created, changed, moved (the feature it leaves too) or deleted.
- **History**: every change appends an `ArtifactHistoryEvent` (`created`, `updated` with `changes`
  `{ field, from?, to? }` where sections read `section:<name>` and `to` is `replaced|appended|cleared`,
  `commented` with `text`, `assigned`, `released`) by an `ArtifactActor` (`agent` with role, `user` with channel,
  or `system`). `ArtifactHistoryService` owns the clock and ids.

## Port and use cases

`IArtifactsPort` (implemented by `ArtifactsService`, the only export of `ArtifactsModule`): `list(conversationId, filter?)`
(open ones by default; `statuses: 'all'`, `types`, `parentId` with `null` for roots, `projectName`, which a feature matches when it links the project and a task when it
works in it), `get`,
`create`, `update`, `comment`, `remove`, `assign`, `release` and `onChange(listener)` (`saved` or `deleted`, with the
`conversationId`). Mutations return `{ ok: true, artifact } | { ok: false, error }` with an English reason, never throw.
Each mutation is one use case (`create-`, `update-`, `comment-on-`, `delete-`, `assign-`, `release-artifact`); the
rules shared by create and update live in `ArtifactRulesService`; create, update and delete apply the derived statuses.

- `update` applies all changes or none, records only real changes and publishes nothing when nothing changed.
- `remove` refuses an artifact with children or a holder, and removes it from the dependencies of the others,
  recording why in their history.
- `assign` refuses while another delegation holds the artifact; the same delegation keeps it. `release` frees it
  only for the delegation holding it, so a replaced agent closing late never frees its successor's work.
- `ReleaseStaleAssignmentsUseCase` releases every holder on boot (`onModuleInit`): no agent survives a restart.
- **Freeze**: `assign` refuses a `frozen` artifact, and freezes (status `frozen`, a `system` history event "Frozen after
  N delegations") an artifact that already went through `ArtifactLimitsConfigService.getMaxDelegations()` delegations
  (`ARTIFACT_MAX_DELEGATIONS`, default 25, `0` disables it), counted as `assigned` events since it was created or last
  left `frozen`. A task bouncing between agents needs the user: no agent request sets `frozen` or moves an artifact out
  of it, and a delegation of a frozen artifact is refused; only a channel acting for the user changes it, and the web
  interface's unfreeze dialog can also comment an instruction and send it to the CEO. `blocked` stays the CEO's own hold.
- **Stopping work**: a user (actor `user`, any channel) who moves a held artifact to one of `WORK_ENDING_STATUSES`
  (`done`, `blocked`, `cancelled`; the protocol exports the same list, checked by `artifact-catalog.constant.spec.ts`)
  stops the agent holding it, through the orchestrator's `StopArtifactWorkUseCase`. Moves by agents never stop anyone.
  `utils/artifact-status.util.ts` tells who set the current status (`lastStatusChange`) and whether a user set it while
  the holder worked (`statusSetByUserWhileHeld`).

`IArtifactStorePort` (`SqliteArtifactStoreAdapter`, see the `database` skill): the board of every conversation lives
in the `artifact` tables, keyed by conversation and artifact id. `transaction(conversationId, work)` runs, in one
`SqliteTransactionService.run`, a read of the board, `work` synchronously over a staged copy of it, and the writes of
the rows that differ from what was read: an artifact saved again unchanged writes nothing, and of a changed one only
its row and the lists that changed are rewritten (history events by position, so an appended event is one insert).
Parallel delegations and other processes never interleave, a `work` that throws writes nothing, and the `F`/`T`
counters of `artifact_counter` outlive deleted artifacts, so ids are never reused. Each artifact keeps the place on the
board it took when first saved. Rows are validated with the protocol's `artifactDetailSchema` on read; an invalid
artifact is logged (`artifacts_invalid_row`) and left out. `conversations()` lists the conversations with artifacts.
Specs use `InMemoryArtifactStoreFake`, `buildArtifact`, `buildPopulatedArtifact`, `createArtifactHarness` and
`createArtifactsService` from `testing/`.

## Agents and the board (orchestrator)

- **Requests** go inside the final response and are read by `AgentRequestParserService`, ignoring Markdown code
  and the body of `<delegate>` tags: `<artifact_list type status parent project/>`, `<artifact_read id="T-1,T-2" tree="true"/>`,
  `<artifact_create type title project projects parent depends_on ref <kind>_refinement>` with
  `<section name>` children, `<artifact_update id title status parent project projects depends_on branch note
  <kind>_refinement>` (one `<kind>_refinement` attribute per refinement kind: `business_refinement`,
  `design_refinement`, `technical_refinement`) with `<section name mode="replace|append">` and
  `<pull_request url title repository state/>` children, and `<artifact_comment id>text</artifact_comment>`. `none` clears
  `parent`, `depends_on` and `branch`; `ref` names an artifact created earlier in the same response. `project` is the project of a task and
  `projects="a,b"` the projects of a feature (the tools take `project` and `projects: string[]`, both under the `project`
  field of the role); the items of the `pull_requests` tool take `repository` too.
- **Round trip**: `ExecuteAgentTurnUseCase` resolves the requests of every CEO and delegate response before anything
  else reads it: `RunAgentRequestsUseCase` runs them in order and answers an `<request_results>` block (one
  `<request_result request id ref status="ok|error">` each). The parser also returns the response without its requests
  (`rest`). When that rest has an outcome (a `<delegate>` or `<question>` for the CEO, a `<question>` for a delegate),
  it goes on as usual and the results open the agent's next prompt (`PendingRequestResults`), so the CEO sets a status
  and delegates in one response. A response whose requests all update, comment or write a skill and succeeded, next to
  the text of an answer, is that answer, delivered with them. Otherwise (a read, a creation, whose id the agent must read,
  a failure, nothing but requests) the results come back right away with a note that the response was not the final
  answer and asking for the whole final answer again, until a response carries none (at most 30 rounds); the CEO's draft is discarded first, and
  `AgentProtocolService.visibleReply` hides the tags. The content an agent reads never passes through the CEO.
- **Tools**: an agent whose CLI takes an HTTP MCP server also makes each request as a tool of the same name during its
  turn; the orchestrator reads the tool's arguments into the same request and carries it out with the same checks and
  messages, one request per call. The tags keep working alongside.
- **Access** (`ArtifactAccess` from `IAgentRegistryPort.getArtifactAccess`, declared per definition in
  `agent-definitions/constants/artifact-access.constant.ts`): `scope` `board` (CEO: lists everything, reads one
  artifact at a time, changes status and refinements of a held artifact), `tree` (Product Owner, UX/UI Designer and Tech Lead:
  `tree="true"` reads, writes any artifact nobody else holds) or `task` (Developer, Git Ops, Code Reviewer, QA: lists and
  reads tasks only, writes only the task it holds); `create`; writable `sections`; writable `fields` (`title`,
  `parent`, `project`, `depends_on`, `status`, `refinement`, `branch`, `pull_requests`). Comments need only read access.
  An unknown role reads tasks only.
- **Delegation**: `<delegate ... artifact="T-1">` (contract `artifact: 'required' | 'optional'`, plus `needsReviewableWork`)
  is validated before it starts: known artifact, a task for a `task` scope, not closed, in a status the role takes (its
  `statusFlow.from`), a pull request or a branch when required, no holder of another role, the artifact's project (for a
  feature, its first project; the `project` attribute may be left out; another one is refused), and a specification within `DELEGATION_SPEC_MAX_CHARS`
  (no limit to redirect the agent of that role already working on that artifact, which receives only the new text).
  One artifact appears in one delegation per response. The delegate holds it from start to end (`assign`
  before the port is created, `release` in `finally` with `finished|failed|cancelled|replaced|stopped|stopped by the user`), starts from a
  `[DELEGATED_ARTIFACT]` block before the task, and is steered only when the artifact is the same. Each role keeps one session
  per task and coding agent: a session new to the task gets the full content, and a resumed one the facts (status,
  dependencies, refinements, holder, branch, pull requests) plus the sections changed and comments added since its own work
  on the task ended, which its session binding records (the full content when it records none, and always for a feature).
- **Statuses of a delegated task**: the server moves them, as `system` history events (`DelegationStatusService` in the
  orchestrator). Once assigned, a task in one of the role's `statusFlow.from` takes its `statusFlow.start`, and the
  delegation works in that status; a task somewhere the role does not take (restored work skips the validator) is left
  alone and gets no verdict. The verdict that opens the agent's final answer, written in English exactly as its prompt
  shows it, sets the status `statusFlow.verdicts` maps it to, while the agent still holds the task and only while the task
  is still in the status the delegation worked in, so a status anyone else set meanwhile stands. QA's `PASSED` leaves it
  `tested`. A failed, stopped, replaced or cancelled delegation, or an answer without a verdict, changes nothing. The CEO sets only the statuses that are decisions (`done`, `blocked`, `cancelled`, reopening, skipping a step).
  The artifact travels in `ActiveDelegation.artifactId`, `DelegationEvent.artifactId`, `OpenWork.artifactId`,
  `QuestionAsker.artifactId`, `[TEAM_PROFILES]` (`Artifact: T-1`) and
  `<agent_result artifact="T-1" verdict="…" artifact_status="…">`, whose status is read after the verdict is applied
  so the CEO never answers with a status the result contradicts. `artifact_status_by="user"` follows
  when a user set that status while the agent worked, and the CEO keeps it; `artifact_read` shows `Status: <status>, set
  by the user` whenever a user set the current status.

## Channels

The web channel maps the port in `WebArtifactsService`; Discord shows the artifact of a delegation (`on \`T-3\``)
and reaches the board through the same port when it gets commands for it.
