---
name: artifacts
description: >
  Board of features and tasks of each conversation: the artifacts module, the IArtifactsPort and its rules
  (two levels, one project per feature, dependencies, statuses, refinements, one holder per artifact, history),
  the per-conversation JSON store, and how agents read and write the board with artifact requests
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
- **One project per feature.** Every artifact has `projectName`, an existing direct folder of the workspace root
  (`IWorkspacePort.listProjectFolders`). A task under a feature always has the feature's (left out, it is taken);
  a feature with tasks cannot change project. Work spanning repositories is one feature per project, linked
  through feature dependencies.
- **Dependencies link siblings** (`ArtifactRulesService.checkDependencies`): a feature depends on other features, a
  task on other tasks of its feature, a standalone task on other standalone tasks; no cycles. A task moves to another
  feature (or out of one) only when no sibling it leaves behind depends on it (`checkDependents`), and its own
  dependencies must fit the new place. Listings show the dependencies still open as `waiting on`.
- **Fields**: `title`, `status` (`backlog`, `ready`, `in_progress`, `in_review`, `changes_requested`, `approved`,
  `in_testing`, `done`, `blocked`, `frozen`, `cancelled`; `done` and `cancelled` are closed), `refinement.business` / `refinement.technical`
  (`pending`, `done`, `skipped`), `dependsOn`, `assignee`, `branch`,
  `pullRequests` (`url`, `title?`, `state` `open|merged|closed`, upserted by URL), `sections` and `history`.
- **Sections** (`ARTIFACT_SECTIONS`, titles in `ARTIFACT_SECTION_TITLES`): `overview`, `user_stories`, `scope`,
  `business_rules`, `flows`, `acceptance_criteria`, `test_cases`, `glossary`, `pending_decisions`,
  `open_questions`, `technical_solution`, `implementation_notes`, `review_findings`, `test_report`. A section is Markdown; an
  empty one is absent. `review_findings` holds the verdict and findings of the last review, whether of a pull request or of
  the task's branch reviewed locally, and `test_report` the verdict and results of the last practical test (QA), so whoever
  fixes the task finds them there.
- **Creation**: a task that owes no refinement starts `ready` (a simple task straight to development); anything
  else starts in the `backlog`. A refinement left out is `pending`.
- **History**: every change appends an `ArtifactHistoryEvent` (`created`, `updated` with `changes`
  `{ field, from?, to? }` where sections read `section:<name>` and `to` is `replaced|appended|cleared`,
  `commented` with `text`, `assigned`, `released`) by an `ArtifactActor` (`agent` with role, `user` with channel,
  or `system`). `ArtifactHistoryService` owns the clock and ids.

## Port and use cases

`IArtifactsPort` (implemented by `ArtifactsService`, the only export of `ArtifactsModule`): `list(conversationId, filter?)`
(open ones by default; `statuses: 'all'`, `types`, `parentId` with `null` for roots, `projectName`), `get`,
`create`, `update`, `comment`, `remove`, `assign`, `release` and `onChange(listener)` (`saved` or `deleted`, with the
`conversationId`). Mutations return `{ ok: true, artifact } | { ok: false, error }` with an English reason, never throw.
Each mutation is one use case (`create-`, `update-`, `comment-on-`, `delete-`, `assign-`, `release-artifact`); the
rules shared by create and update live in `ArtifactRulesService`.

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

`IArtifactStorePort` (`JsonArtifactStoreAdapter`): one file per conversation,
`DATA_DIR/artifacts/<encodeURIComponent(conversationId)>.json` (`{ counters, artifacts }`, validated with the protocol
schema; invalid or missing means empty). `transaction(conversationId, work)` runs one at a time over a staged copy and
commits only after the atomic write (temporary file, then rename). Specs use `InMemoryArtifactStoreFake`,
`buildArtifact`, `createArtifactHarness` and `createArtifactsService` from `testing/`.

## Agents and the board (orchestrator)

- **Requests** go inside the final response and are read by `AgentRequestParserService`, ignoring Markdown code
  and the body of `<delegate>` tags: `<artifact_list type status parent project/>`, `<artifact_read id="T-1,T-2" tree="true"/>`,
  `<artifact_create type title project parent depends_on ref business_refinement technical_refinement>` with
  `<section name>` children, `<artifact_update id title status parent project depends_on branch note
  business_refinement technical_refinement>` with `<section name mode="replace|append">` and
  `<pull_request url title state/>` children, and `<artifact_comment id>text</artifact_comment>`. `none` clears
  `parent`, `depends_on` and `branch`; `ref` names an artifact created earlier in the same response.
- **Round trip**: `ExecuteAgentTurnUseCase` resolves the requests of every CEO and delegate response before anything
  else reads it: `RunAgentRequestsUseCase` runs them in order and answers an `<request_results>` block (one
  `<request_result request id ref status="ok|error">` each). The parser also returns the response without its requests
  (`rest`). When that rest has an outcome (a `<delegate>` or `<question>` for the CEO, a `<question>` for a delegate),
  it goes on as usual and the results open the agent's next prompt (`PendingRequestResults`), so the CEO sets a status
  and delegates in one response. Otherwise the results come back right away with a note that the response was not the
  final answer, until a response carries none (at most 30 rounds); the CEO's draft is discarded first, and
  `AgentProtocolService.visibleReply` hides the tags. The content an agent reads never passes through the CEO.
- **Access** (`ArtifactAccess` from `IAgentRegistryPort.getArtifactAccess`, declared per definition in
  `agent-definitions/constants/artifact-access.constant.ts`): `scope` `board` (CEO: lists everything, reads one
  artifact at a time, changes status and refinements of a held artifact), `tree` (Product Owner and Tech Lead:
  `tree="true"` reads, writes any artifact nobody else holds) or `task` (Developer, Git Ops, Code Reviewer, QA: lists and
  reads tasks only, writes only the task it holds); `create`; writable `sections`; writable `fields` (`title`,
  `parent`, `project`, `depends_on`, `status`, `refinement`, `branch`, `pull_requests`). Comments need only read access.
  An unknown role reads tasks only.
- **Delegation**: `<delegate ... artifact="T-1">` (contract `artifact: 'required' | 'optional'`, plus `needsReviewableWork`)
  is validated before it starts: known artifact, a task for a `task` scope, not closed, a pull request or a branch when required,
  no holder of another role, and the artifact's project (the `project` attribute may be left out; another one is
  refused). One artifact appears in one delegation per response. The delegate holds it from start to end (`assign`
  before the port is created, `release` in `finally` with `finished|failed|cancelled|replaced|stopped`), starts from a
  `[DELEGATED_ARTIFACT]` block with its full content before the task, and is steered only when the artifact is the same.
  The artifact travels in `ActiveDelegation.artifactId`, `DelegationEvent.artifactId`, `OpenWork.artifactId`,
  `[TEAM_PROFILES]` (`Artifact: T-1`) and `<agent_result artifact="T-1" artifact_status="…">`, whose status is read when
  the agent finishes so the CEO never answers with a status the result contradicts.

## Channels

The web channel maps the port in `WebArtifactsService`; Discord shows the artifact of a delegation (`on \`T-3\``)
and reaches the board through the same port when it gets commands for it.
