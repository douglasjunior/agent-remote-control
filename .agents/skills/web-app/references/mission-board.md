# Mission board (artifacts)

Each conversation has its own board of features and tasks (the `artifact.ts` contract of the protocol): a feature groups the tasks of one mission, a task sits in a feature or stands alone, and every artifact belongs to a project folder, a task in a feature taking the feature's.

## Routes and panes

- Routes: `/c/:conversationId` (chat), `/c/:conversationId/tasks` (board), `/c/:conversationId/tasks/:artifactId` (one artifact) and `/c/:conversationId/squad` (the squad, see [team-presentation.md](team-presentation.md)), all rendered by `ConversationPage`, which hands `ConversationView` a `pane` (`chat`, `board`, `artifact` or `squad`).
- The board and the artifact replace the chat column only: the squad panel of a wide window stays beside them, and the chat stays mounted and `hidden`, so the composer draft and the feed survive a visit to the board.
- `ConversationNav` (`components/conversation-nav.tsx`) is the one navigation of a conversation: links with `aria-current="page"` on the current section, keyboard reachable with a visible focus ring, and the number of open tasks (not done or cancelled) on Tasks, read as "Tasks, N open". A wide window shows `Chat | Tasks` in the chat header; a narrow one spreads `Chat | Tasks | Squad` over the width under it.
- `conversationPath`/`squadPath` (`conversations/conversation-paths.ts`) and `boardPath`/`artifactPath` (`artifacts/artifact-paths.ts`) build every link.
- A delegation handoff row whose entry carries `artifactId` shows a chip linking to that artifact.

## State

- `ArtifactsProvider` (mounted in `AppLayout`, outside the conversations reducer) keeps `artifactsReducer`'s `boards` (per conversation: `loaded`, `byId` summaries, `details` opened so far) and the workspace `projects`.
- It sends `projects.list` on every `open`; `ConversationView` sends `artifacts.list` with the history.
- `artifact.updated` and `artifact.deleted` change only their conversation's board, and an update also refreshes the open detail's summary fields.
- `useBoard(conversationId)` returns the board and the mutations bound to it; each mutation sends its command with a fresh `requestId`, resolves with the matching `artifact.result`, shows the error in a sonner toast, and resolves with an error when the connection leaves `open`.

## Board views

- `ArtifactBoard` has two views, picked in its `List | Kanban` shadcn `ToggleGroup` (labels shown from `@sm` of the board, screen-reader only below), the choice kept by `useStoredFlag` under `arc.artifactsBoard` (default List):
  - the list (`ArtifactTreeView`) groups by project, each with its features (collapsible, with a done/total progress bar) and their tasks, then a "Standalone tasks" group;
  - the kanban (`ArtifactKanban`) shows the tasks or, through the "Cards" select among the filters ("Task cards" or "Feature cards", kept under `arc.artifactsBoardFeatures`, default tasks), the features, one column per status in workflow order (Done and Cancelled only while "Hide done and cancelled" is off).
- The board lays out by container queries (`@container` on its root), because its width depends on the side panels. Below `@2xl` the kanban columns snap one at a time, each at most the board width minus 3rem so the next one peeks in, and a "Columns" group of chips (`<Status>, <count>`) scrolls a column into view (`scrollIntoView`, smooth only under `motion-safe`).
- A card moves by HTML5 drag and drop onto a column, or by its "Move" menu, the keyboard path; both send `artifact.update { status }`, except that moving a held card to a status that ends the work (`stopsWork`: `WORK_ENDING_STATUSES` of the protocol) first asks in `ArtifactStopWorkDialog` ("Keep working" or "Move and stop"), since the server then stops the agent holding it; the status select of `ArtifactDetail` asks the same way.
- A feature card shows the progress of its tasks as one bar split by status (done over total, cancelled tasks left out, the breakdown in its accessible name and tooltip) and is moved like a task card, frozen rules included.
- A held card's border takes the holder's agent color. Rows and cards show the id, the feature, the project, a "Waiting on" chip for dependencies not done, the pull request count and the holder's `AgentMark` in the working state.
- Filters: text (id or title), project, type (list only; the kanban ignores it, since Cards plays that part) and hide done/cancelled, which apply to whichever type the kanban shows. From `@2xl` they sit inline after the search, with "New" at the end of the row. Below it the row holds the search, a "Filters" button with the number of active filters (project, the list's type, hide done; read as "Filters, N active") and an icon-only "New"; the button opens `ArtifactFiltersSheet`, a bottom `Sheet` with the same controls labelled, "Clear filters" and "Done".
- Statuses follow the protocol order, In testing (the QA agent's turn, toned `--agent-qa`) and Tested (passed and waiting for the merge, toned `--good`) between Approved and Done; the sections too, Test report after Review findings, UX design before Technical solution.

## Creating

`ArtifactCreateDialog` creates a feature or a task: a feature needs a project; a task picks a feature, whose project it takes (the project select is then disabled), or stands alone with a project of its own. Dependencies join siblings of the same type only (`dependencyCandidates`): a task in a feature depends on other open tasks of that feature, a standalone task on other standalone tasks, a feature on other features; changing the type or the feature drops the dependencies the new level does not share. A switch per refinement kind (`REFINEMENT_KINDS`) asks for the Product Owner's business refinement and the Tech Lead's technical refinement, on by default, and the UX Designer's design refinement, off by default; every switch off marks a simple task that goes straight to the Developer.

## Artifact detail

- `ArtifactPane` sends `artifact.get` when the connection opens and again on every `artifact.updated` of that artifact.
- `ArtifactDetail` shows the breadcrumb, the title (renamed in place), the holder ("<Agent> is working on it"), the sections in protocol order (Markdown, each edited in a textarea; empty ones are added from "Add section"), the tasks of a feature (with "Add task", which opens the dialog with the feature chosen), the activity (a comment box over the history, newest first: actor, summary, field changes with labels, comments) and, in the `Properties` aside, status, refinements, project (editable only for a standalone task or a feature without tasks), feature, dependencies (the picker offers the same siblings as the dialog, for features too), the artifacts it blocks, branch and pull requests.
- Delete asks for confirmation in an `AlertDialog` and returns to the board.
- The detail lays out in two columns through a container query (`@container` on the pane), because its width depends on the squad panel, not on the viewport.

## Frozen tasks

The server freezes a task that reached the maximum number of delegations, and only the user moves it out.

- `ArtifactStatusBadge` draws it with a snowflake in the `--frozen` token (light and dark in `index.css`), and the kanban shows the Frozen column, between Blocked and Cancelled, only while a visible task is frozen.
- Leaving Frozen always goes through `ArtifactUnfreezeDialog`, opened by the "Unfreeze" button of a list row, the "Unfreeze…" item of a card menu, a frozen card dropped on another column or picked into another status, the banner of the task's page ("Frozen after too many delegations") or its status select.
- The dialog picks the status to return to (`UNFREEZE_STATUSES`, every open status, defaulting to the one asked for when open, otherwise Ready) and an optional instruction for the CEO.
- Confirming sends `artifact.update { status }`; once it succeeds and an instruction was written, it sends `artifact.comment` with it and a `message.send` to the same conversation: `Task <id> "<title>" was unfrozen and moved to <Status>. Instructions: <instruction>`. Without an instruction nothing goes to the chat.
