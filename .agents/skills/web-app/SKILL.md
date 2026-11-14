---
name: web-app
description: >
  React web app in packages/web: folder layout, the IServerConnection interface and its WebSocket
  implementation, access token handling, the import convention, testing with Testing Library and
  fake connections, and vendored shadcn/ui components. Use when working with the web package,
  React components, the browser connection to the server or the access token form.
---

# Web app

> **Maintaining this skill**
>
> Update this document whenever any rule described here changes. The criterion is not
> *which* rule — it is the nature of the change: a layout, connection, import or testing rule
> changed → update; a visual tweak that preserves the described behavior → leave it alone.

`packages/web` (`@agent-remote-control/web`) is a React + Vite + React Router + Tailwind v4 + shadcn/ui
app. It talks to the server only through `@agent-remote-control/protocol`, over a WebSocket.

## Layout

```text
packages/web/src/
├── main.tsx                 # bootstrap: ConnectionProvider + RouterProvider
├── router.tsx               # route table (`routes`) and the browser router
├── connection/              # IServerConnection, WebSocket implementation, AccessTokenStore, context
├── conversations/           # reducer, context and entry grouping
├── artifacts/               # the mission board of each conversation: reducer, context, useBoard, tree helpers, labels, paths
├── theme/                   # ThemeProvider and useTheme (light, dark, system)
├── pages/                   # route-level screens
├── components/              # app components; components/ui is vendored shadcn
│   ├── agent/               # AgentMark: the round lens with an animated glyph per role
│   ├── squad/               # SquadPanel (right panel), Station, spine and motion hooks, squad status
│   ├── usage/               # UsageIndicator (header), UsagePanel, useAgentQuota, quota levels
│   ├── auth/                # AgentAuthController (toasts), AgentAuthPopover (header), AgentLoginCard, useAgentAuthStatus
│   ├── artifacts/           # ArtifactBoard (list and kanban), ArtifactPane and ArtifactDetail, create dialog, properties, activity
│   ├── skills/              # SkillList, SkillDetail, SkillRoles and the skill paths of the skills page
│   └── entries/             # feed rows: handoff rows, activity groups, messages, questions
└── lib/                     # cn(), agent-identity (mark, color, stage, responsibility per role), tool-label, formatting, clocks, media query
```

## App shell

`AppLayout` renders a header (a `PanelLeftOpen`/`PanelLeftClose` `IconButton` "Show conversations"/"Hide conversations" with `aria-expanded`, the primary "New conversation" button, the truncating `h1`, then the Skills link (an icon link with a tooltip, to `/skills`), the agent logins popover, usage indicator, connection badge and theme toggle on the right) above the page. From 768 px of viewport the conversation list is a docked `aside` (`id="conversation-list"`, 288 px) that pushes the page; it stays mounted and `hidden` while closed, defaults to closed and the choice is kept by `useStoredFlag` under `arc.conversationListOpen`. Below 768 px the same toggle opens `ConversationList` in a left shadcn `Sheet` (not persisted), which picking a conversation closes (`onNavigate`). "New conversation" lives only in the header (icon-only below `sm`) and the empty state of `ConversationPage`.

## Connection

- Components depend on `IServerConnection` (`connect`, `disconnect`, `send`, `onEvent`, `onStatus`, `hasAccessToken`, `setAccessToken`), never
  on `WebSocket`, so another transport can replace `WebSocketServerConnection`. Status is
  `'connecting' | 'open' | 'unauthorized' | 'closed'`; `onEvent` and `onStatus` return an unsubscribe function.
  `hasAccessToken()` says whether a token is at hand (in storage or in a `#token=` link the page was opened with)
  and `setAccessToken(token)` keeps the one the user typed.
- `WebSocketServerConnection` receives an `AccessTokenStore` through its constructor (`main.tsx` creates it) and always connects to the relative `/ws` (`wss` on https), sends `auth` first and
  reports `open` on `auth.ok`. `auth.failed` or close code `4401` clears the stored token, reports
  `unauthorized` and stops. Other closes reconnect with exponential backoff from 500 ms to a 10 s cap, reset
  after a successful auth. Commands sent while not `open` are queued and flushed after `auth.ok`. Every frame
  goes through `parseServerEvent`; invalid frames are dropped with `console.warn`.
- `ConnectionProvider` owns the token state and the connection lifecycle: it asks the connection for the token
  (`hasAccessToken`, `setAccessToken`), connects when one exists and
  exposes `status`, `hasToken` and `submitToken` through `useConnection()`. Without a token (or after
  `unauthorized`) `AppLayout` renders `MissingTokenPage`.
- `AccessTokenStore` (`connection/access-token-store.ts`) keeps the token in `localStorage` (`arc.accessToken`) with `read`, `store`, `clear` and `load`. `load` first takes a `#token=` URL fragment into storage and removes it
  with `history.replaceState`. Every storage access is wrapped in `try/catch`.
- The app always connects to the relative `/ws` (`wss` on https pages). Vite proxies `/ws` and `/health` to the server in `dev` and `preview` without `changeOrigin`, so the server's origin check sees a same-origin request; the target port is the `PORT` of the root `.env` (default `3000`). nginx proxies the same path in production.

## Imports and vendored UI

- Relative imports with the `.js` suffix, which Vite resolves to `.ts`/`.tsx`. The `@/` alias is not used.
- `components/ui/**` is shadcn code kept as vendored source (style `base-nova`, Base UI); it is excluded from
  coverage. Search and install components as described in the `shadcn-ui` skill, which also covers keeping
  relative imports after each CLI run. Look for a shadcn component before writing one.
- Never disable lint rules globally to make generated code pass.

## Tests

- Specs sit next to the file under test (`*.spec.ts`, `*.spec.tsx`) and run in the Vitest project `web`
  (jsdom, globals, `@testing-library/jest-dom`).
- Use `FakeServerConnection` from `src/test/fake-server-connection.ts` for components; it records sent
  commands, lets the test emit events and statuses, and keeps the token in memory (`accessToken`, a token at the start;
  set it to `null` for a signed-out spec).
- The browser `WebSocket` is an external I/O boundary: stub it with `vi.stubGlobal` and fake timers.
- Target 100% coverage outside `components/ui`.

## Conversation state

- `conversationsReducer` is a pure reducer from `ServerEvent` to `ConversationsState` (`list` ordered by
  `updatedAt` desc, `agents`, and `byId` with `entryIds`, `entries`, `state`, `loaded`, `configured`,
  `profilesLoaded`, `profiles`). `conversation.entry` upserts by id (existing ids replaced in place, new ids
  appended); `conversation.history` replaces the conversation wholesale. Events that carry no state
  (`models.list`, `efforts.list`, `error`, auth) leave it untouched; the settings sheet listens to them
  through `connection.onEvent`.
- `ConversationsProvider` lives inside the router (`AppLayout`). It sends `conversation.list` on every `open`
  status, and navigates to `/c/<id>` on the `conversation.created` whose `requestId` it generated.
  `ConversationView` sends `conversation.history` and `profiles.get` whenever the status is `open` or the
  conversation changes, and `agents.list` while no agents are known.

## Conversation list

`ConversationList` shows the conversations most recent first. Each row has an actions menu (an `IconButton` "Actions for <title>" over the row's right edge, shown on hover, on keyboard focus, while its menu is open and always on coarse pointers) with Rename and Archive or Unarchive, which send `conversation.rename` and `conversation.archive`; the list changes only with the `conversation.updated` the server broadcasts, upserted by the reducer like any other. Archived conversations (`archivedAt` set) leave the main list for an "Archived (n)" group at the bottom, collapsed unless the viewer opened it (`useStoredFlag`, `arc.archivedConversationsOpen`); they stay openable, and archiving the open conversation keeps it open. Renaming happens in place through `TitleInput` (Enter or leaving the field saves, Escape cancels without closing the drawer around it, an empty or unchanged title sends nothing), in the row and from the pencil next to the conversation title in the chat header. The row keeps its menu mounted while renaming, with `finalFocus` off, so closing the menu does not take the focus from the field.

## Skills

`/skills` and `/skills/:skillName` render `SkillsPage`, which sends `skills.list` on every `open` and `skill.get` for the
skill in the route, keeping each `skill.detail` it receives (`null` for an unknown name). From 768 px the list and the
skill sit side by side; below, the route shows one of them and the skill links back to the list. The header link
carries `returnTo` (the page it was clicked on) in the router state (`skillsState`), the links within the page keep it, and
the X ("Close skills") at the top of the list returns there, or to `/` for a page opened from its address.

- `SkillList` filters by text (name or description) and by role (`ChoiceSelect` over the roles that read some skill),
  and groups the skills in "Custom" (the user's, first) and "Built-in". Each row is a `NavLink` with the name, the
  description clamped to two lines and `SkillRoles` (the agent color dot and label of each role).
- `SkillDetail` shows the name, a Custom or Built-in badge, the description, the roles with their `AgentMark` and the
  content as Markdown. A built-in skill is read-only. A custom one offers "Ask the Coordinator", which calls
  `startConversation(changeSkillPrompt(name))`: the conversation is created and opened with `Change the skill "<name>": `
  in its composer for the user to finish. The page lays out through a container query, since its width depends on the
  docked conversation list. A custom skill also has Delete (a trash `IconButton` at the right of its name), confirmed in an `AlertDialog`: it sends `skill.delete`, and the
  matching `skill.result` returns to the list with a toast (or shows the error in a toast). Any `skill.deleted` makes the page
  ask for the list again, and for the open skill when it is the deleted one, since a built-in skill it replaced comes back.
- `startConversation(prompt)` (in `ConversationsProvider`) keeps the prompt by request id and navigates with it in the
  router state; `ConversationPage` reads it once, hands it to `ConversationView` as `initialPrompt` (the composer's first
  text) and replaces the history entry without it, so a reload does not seed the composer again.

## Mission board (artifacts)

Each conversation has its own board of features and tasks (the `artifact.ts` contract of the protocol): a feature groups the tasks of one mission, a task sits in a feature or stands alone, and every artifact belongs to a project folder, a task in a feature taking the feature's.

- Routes: `/c/:conversationId` (chat), `/c/:conversationId/tasks` (board) and `/c/:conversationId/tasks/:artifactId` (one artifact), all rendered by `ConversationPage`, which hands `ConversationView` a `pane` (`chat`, `board` or `artifact`). The board and the artifact replace the chat column only: the squad panel stays beside them, and the chat stays mounted and `hidden`, so the composer draft and the feed survive a visit to the board. The chat header carries the `Chat | Tasks` switch (`NavLink`s, labels visible from `sm`), with the number of open tasks (not done or cancelled) on Tasks. `artifactPath`/`boardPath` (`artifacts/artifact-paths.ts`) build every link.
- State: `ArtifactsProvider` (mounted in `AppLayout`, outside the conversations reducer) keeps `artifactsReducer`'s `boards` (per conversation: `loaded`, `byId` summaries, `details` opened so far) and the workspace `projects`. It sends `projects.list` on every `open`; `ConversationView` sends `artifacts.list` with the history. `artifact.updated` and `artifact.deleted` change only their conversation's board, and an update also refreshes the open detail's summary fields. `useBoard(conversationId)` returns the board and the mutations bound to it; each mutation sends its command with a fresh `requestId`, resolves with the matching `artifact.result`, shows the error in a sonner toast, and resolves with an error when the connection leaves `open`.
- `ArtifactBoard` has two views, the choice kept by `useStoredFlag` under `arc.artifactsBoard`: the list (`ArtifactTreeView`) groups by project, each with its features (collapsible, with a done/total progress bar) and their tasks, then a "Standalone tasks" group; the kanban (`ArtifactKanban`) shows the tasks or, through the "Tasks | Features" switch it adds to the toolbar (kept under `arc.artifactsBoardFeatures`, default Tasks), the features, one column per status in workflow order (Done and Cancelled only while "Hide done and cancelled" is off). A card moves by HTML5 drag and drop onto a column, or by its "Move" menu, the keyboard path; both send `artifact.update { status }`. A feature card shows the progress of its tasks as one bar split by status (done over total, cancelled tasks left out, the breakdown in its accessible name and tooltip) and is moved like a task card, frozen rules included. A held card's border takes the holder's agent color. Rows and cards show the id, the feature, the project, a "Waiting on" chip for dependencies not done, the pull request count and the holder's `AgentMark` in the working state. Filters: text (id or title), project, type (list only; the kanban switch plays that part) and hide done/cancelled, which apply to whichever type the kanban shows.
- `ArtifactCreateDialog` creates a feature or a task: a feature needs a project; a task picks a feature, whose project it takes (the project select is then disabled), or stands alone with a project of its own. Dependencies join siblings of the same type only (`dependencyCandidates`): a task in a feature depends on other open tasks of that feature, a standalone task on other standalone tasks, a feature on other features; changing the type or the feature drops the dependencies the new level does not share. Two switches ask for the Product Owner's business refinement and the Tech Lead's technical refinement; both off marks a simple task that goes straight to the Developer.
- `ArtifactPane` sends `artifact.get` when the connection opens and again on every `artifact.updated` of that artifact. `ArtifactDetail` shows the breadcrumb, the title (renamed in place), the holder ("<Agent> is working on it"), the sections in protocol order (Markdown, each edited in a textarea; empty ones are added from "Add section"), the tasks of a feature (with "Add task", which opens the dialog with the feature chosen), the activity (a comment box over the history, newest first: actor, summary, field changes with labels, comments) and, in the `Properties` aside, status, refinements, project (editable only for a standalone task or a feature without tasks), feature, dependencies (the picker offers the same siblings as the dialog, for features too), the artifacts it blocks, branch and pull requests. Delete asks for confirmation in an `AlertDialog` and returns to the board. The detail lays out in two columns through a container query (`@container` on the pane), because its width depends on the squad panel, not on the viewport.
- Statuses follow the protocol order, In testing (the QA agent's turn, toned `--agent-qa`) between Approved and Done; the sections too, Test report after Review findings.
- Frozen: the server freezes a task that reached the maximum number of delegations, and only the user moves it out. `ArtifactStatusBadge` draws it with a snowflake in the `--frozen` token (light and dark in `index.css`), and the kanban shows the Frozen column, between Blocked and Cancelled, only while a visible task is frozen. Leaving Frozen always goes through `ArtifactUnfreezeDialog`, opened by the "Unfreeze" button of a list row, the "Unfreeze…" item of a card menu, a frozen card dropped on another column or picked into another status, the banner of the task's page ("Frozen after too many delegations") or its status select: it picks the status to return to (`UNFREEZE_STATUSES`, every open status, defaulting to the one asked for when open, otherwise Ready) and an optional instruction for the coordinator. Confirming sends `artifact.update { status }`; once it succeeds and an instruction was written, it sends `artifact.comment` with it and a `message.send` to the same conversation: `Task <id> "<title>" was unfrozen and moved to <Status>. Instructions: <instruction>`. Without an instruction nothing goes to the chat.
- A delegation handoff row whose entry carries `artifactId` shows a chip linking to that artifact.

## Entry rendering

| Entry | Rendering |
|---|---|
| `user_message` | Right-aligned bubble |
| `agent_response` | Agent mark and clickable colored name, Markdown, and a footer `roleName · agentName · modelName · effortName`; `failed` shows `errorMessage`; `cancelled` shows a muted label |
| `interim` | Muted markdown under the Coordinator's mark and name |
| `delegation` | One handoff row per delegation (`started` joined with its `finished` or `failed` entry by `delegationId`, never by round and role, which repeat across turns): agent mark, the CEO's `summary` as the title, the agent's name below, the live time or the duration; delegations of the same round that follow each other with no other entry between them stack as one squad. A chevron opens the CEO's `prompt` (a tinted block that scrolls past 240 px; empty entries from older histories show nothing), then the agent's steps, then its response or error |
| `thought`, `tool`, `skill` | Consecutive runs of one agent (`role`) grouped in one collapsible, closed by default and headed by the agent's name and what it does now (`toolLabel` turns tool titles into plain words); steps of a delegated agent go inside its delegation row instead; `removed` thoughts are hidden. A `skill` step reads "Read the skill", "Created the skill" or "Updated the skill" ("Could not read/write the skill" with the error as its title when it failed), each name linking to `/skills/<name>`, and `stepLabel` gives the group and the squad "Reading a skill" or "Writing a skill" |
| `question` | Card with an attention border, titled by the asker's name, with one button per option (1-based `optionIndex`) and an inline `PromptInput` for an answer of its own, with attachments and voice; "Question n of m" when `total > 1`; only the open question (`closed: false`) is enabled; a closed one keeps the asker and the text |
| `notice` | Inline line styled by `level` |

The composer is disabled while the connection is not `open` or the conversation is not `configured`
(the settings sheet then opens by itself). It stays enabled while a turn runs, next to a Stop button that
sends `turn.cancel`.

`FeedList` (`components/entries/`) renders the entries with `react-virtuoso` inside the `message-viewport` div
(`customScrollParent`), one `FeedItem` per grouped item. Off-screen rows are unmounted, so the open state of
activity groups and handoff rows lives in `FeedList` (a set of item ids), not in the rows; so do the focus and the hover callbacks, which pass through the Virtuoso context. `useStickToEnd`
keeps the viewport pinned to the end through a `ResizeObserver` on the viewport content, until the reader scrolls
up; scrolling back within 24 px of the end resumes it, and so does a new `user_message`. While the reader is away
from the end, an `IconButton` "Scroll to bottom" appears over the feed. Specs that render the feed wrap it in
`VirtuosoMockContext` (jsdom has no layout; `renderApp` already does) and fire the observer through a stubbed
`ResizeObserver`. `FeedList` follows the visible range through Virtuoso's `rangeChanged`. While an open question is outside it, a `WaitingLine` sits between the feed and the composer: "<Agent> is waiting for your answer" in the agent's color with a "Go to question" button, one line because only one question is open. The button and a click on a `waiting` station (besides its normal selection, switching to the Chat tab on a narrow window) call `FeedHandle.goToQuestion`: it releases `useStickToEnd` so the scroll away from the end is not undone, scrolls with `scrollToIndex` on the Virtuoso ref and focuses the card's first control. `VirtuosoMockContext` does not scroll, so specs of that path replace `Virtuoso` with a stand-in that records `scrollToIndex` and reports a fixed range (`feed-list-scroll.spec.tsx`). The "Working…" indicator stays hidden only while the last entry is itself the open question.

The response being written arrives as `conversation.draft` events (`ConversationView.draft`, set by the reducer
and by `conversation.history`) and shows as streaming Markdown (`isAnimating`) after the last entry, where the delivered response replaces
it. While a draft shows, the grouped steps no longer read "Working…".

`usePromptHistory` (`components/prompt-input/`) gives the composer shell-like history: the first `ArrowUp` on
the first line sends `prompts.history` and the navigation runs over the `prompts.list` answer (matched by
`requestId`, 5 s timeout) until the message is sent. `ArrowDown` on the last line walks back to the text being
typed. The server records prompts; the client never appends.

`useFileMentions` opens a file list when the caret is on an `@` that begins a word. Each open list is one
server search session: the hook generates a `requestId`, sends `files.search` with it (no wait for a bare `@`,
200 ms after typing a query), applies every `files.results` for that id (the list fills while `walking` is
`true`) and sends `files.close` when the list closes. "Open" is derived from text, caret, focus and results;
`Esc` dismisses the token until the caret leaves every mention. The highlight returns to the first item when
the searched query changes, not when more results stream in. While the list is open the arrows, `Tab` and
`Enter` belong to it, before the history and the send. A file is inserted as `@path ` (quoted when it has
whitespace); a directory as `@dir/` with no space so the list goes into it. The popup highlights the
characters listed in each item's `matches`, dims the folder part and shows a spinner while `walking`.
Attachments (`usePromptAttachments`): a file picked with the paperclip, dropped on the composer frame or pasted
into the field uploads at once through the upload protocol inside `usePromptAttachments`, which depends only on `IServerConnection` (chunks of
`UPLOAD_CHUNK_BYTES`, one `upload.ack` awaited per chunk, `upload.abort` on cancel, rejection when the status
leaves `open`). Each file is a chip (`AttachmentChip`) that is `uploading`, `ready` or `error`; Send stays
disabled while any is uploading, and the message carries the `ready` ones (text may be empty). A file above
`MAX_UPLOAD_BYTES` fails without being sent, at most `MAX_ATTACHMENTS` are kept, and removing a chip cancels its
upload. `ConversationView` keys the `Composer` by conversation id, so attachments and the draft never cross
conversations. A `user_message` renders its attachments as read-only chips in the bubble.

Voice recording (`useVoiceRecorder`): the microphone button next to the paperclip asks for the microphone and
records with `MediaRecorder` (webm/opus, ogg or mp4, whichever the browser supports). While recording, the
field gives way to a timer with a discard button and an attach button, and Send and the paperclip are disabled.
Attaching stops the recording and hands the audio `File` (`recording-<timestamp>.<ext>`) to
`usePromptAttachments.addFiles`: it uploads like any file and waits as a chip until the message is sent. A
denied microphone or a failed start shows an inline alert. A chevron attached to the microphone button opens a
menu (`useMicrophones`) with "System default" and the audio inputs, the chosen one checked; opening it asks for
microphone access once when the browser still hides device names. The choice is kept in `localStorage`
(`arc.microphone`) and recording asks for that device exactly; a device that is gone falls back to the default. The microphone is released when the recording ends
or the composer unmounts.

`usePromptInput` holds all of the above (text, attachments, recording, mentions, history) and `PromptInput` renders it, in two layouts: `block` with the tools around the field, used by `Composer`, and `inline` with field and tools in one frame, used inside the question card. The state lives apart from the field because the feed unmounts off-screen rows: `AnswerInputProvider` keeps it above `FeedList`, so a recording or an upload survives scrolling, and only the card reads the context, so typing does not render the feed. It resets when the open question changes.

`FileMentionPopup` is composed from tokens, not a shadcn `command`, because the field must keep the focus.

## Agent usage

`UsageIndicator` (`components/usage/`) sits in the header next to the connection badge: one vertical meter per agent, in the server's order, each at the agent's closest limit (`tightestFraction`), then the highest percent used in mono (0% untouched, 100% exhausted). An agent without numbers shows an empty track; with no reports yet the tracks pulse and the text is `–`. The accessible name carries the percent. Levels match the Discord `/usage` (`quotaLevel`: `good` from 50%, `attention` from 20%, `critical` below, drawn with `--good`, `--attention` and `--destructive`).

A click opens `UsagePanel` in a shadcn `Popover`, built to be read at a glance: one line per bucket in columns aligned across the agents under a "Limit, Used, Resets" header, with the label, a thin bar, the percent used and a compact time until the reset (`formatCountdown`; the full sentence is the `title` and the screen reader text), left out once it has passed. Color marks what needs attention: a percent stays in the foreground color while `good`, and a `critical` row is tinted. `bucketLabel` names a bucket by its window and adds the qualifier from its name when a sibling shares that window (`Week · Sonnet only`). A group is named only when the agent has more than one; an agent without numbers takes one line, with "No usage data" or "Could not read usage". A row never moves on refresh, because the order is the server's.

`useAgentQuota` holds the numbers outside the conversations reducer, since only this indicator reads them. It sends `quota.get` when the status becomes `open`, every `QUOTA_REFRESH_MS` (5 minutes) while the tab is visible, and on returning to the tab when the numbers are that old; the panel's refresh button sends `refresh: true`. Each query starts the agents' CLIs, so keep this rate low. The last numbers stay on screen through a refresh, a `quota.failed` ("Could not refresh") or a lost connection.

## Agent logins

`AgentAuthController` (`components/auth/`) sits in the header and renders `AgentAuthPopover` (a key button, with a red dot while an agent needs a login, opening one row per agent: name, account detail, a "Logged in", "Not logged in" or "Unknown" badge and an "Authenticate" or "Re-authenticate" button). `AppLayout` also mounts the sonner `Toaster` once, so every toast of the app and of the specs renders.

`useAgentAuthStatus` holds the state outside the conversations reducer, which passes `auth.status`, `auth.status.failed` and `auth.login` through unchanged. It sends `auth.status` when the status becomes `open`, every `AUTH_REFRESH_MS` (5 minutes) while the tab is visible, and on returning to the tab when the answer is that old. It keeps the agents (`null` until the first answer; `auth.status.failed` keeps the last answer) and a login state per agent: `idle`, `starting`, `waiting` (link and optional one-time code), `prompt` (the CLI waits for a code pasted from the browser) or `failed` (reason). `completed` and `cancelled` return to `idle`; `completed` also calls the hook's `onCompleted` and sends `auth.status` with `refresh: true`. Actions: `login`, `submitCode` (`auth.input`) and `cancel`.

After a code is sent the login state is `verifying`: the card shows a spinner with `Checking the code…` and the toast says the same, until `completed`, `failed` or a new `prompt`; a `prompt` that arrives while verifying means the code was not accepted, so the card shows an alert above the input. The controller keeps one toast per agent that is not logged in or has a login in progress, with the stable id `auth-<agentId>`, `duration: Infinity` and `dismissible: false`, so it only goes away when the agent is logged in, the login is cancelled or the agent disappears. Nothing is shown before the first answer, and an `unknown` agent never gets one. The toast text follows the login state: "is not logged in" with an Authenticate action; starting; the link ("Open login page", `target="_blank"`, `rel="noopener noreferrer"`, rendered only for `https:` URLs by `safeLoginUrl`) with the one-time code and its copy button and a Cancel action; for a pasted code, an "Enter code" action that opens the popover; failure with the reason and a Try again action. A completed login shows an auto-dismissing success toast.

The code the browser shows is typed in the popover's `AgentLoginCard`, not in the toast: an input inside a toast that cannot be dismissed loses focus on every toast update. For the same reason a toast carries a single action button (sonner ignores `cancel` on a toast that is not dismissible), so Cancel on the code toast is a button in its description.

## Theme

`ThemeProvider` keeps the choice (`'light' | 'dark' | 'system'`, default `'system'`) in `localStorage`
(`arc.theme`) and toggles the `dark` class on `<html>`; `system` follows `prefers-color-scheme` live. An inline
script in `index.html` applies the class before the first paint. `ThemeToggle` (a shadcn dropdown menu) sits in
the header. Style through the theme tokens so both modes work.

Scrollbars are styled once, in the base layer of `index.css`, for every scrolling element: a thin floating thumb on a transparent track, from `--scrollbar-thumb` and `--scrollbar-thumb-hover`. A component adds no scrollbar styling of its own; `scrollbar-width` or `scrollbar-color` on an element turn the `::-webkit-scrollbar` rules off in Chromium, so those properties apply only where the pseudo-elements do not exist.

- `QuestionCard` shows the asker with its project, the question's `message`, text and rationale ("Why it matters"), as every channel does. The question the server has not closed (`closed: false`) can be answered wherever it sits in the feed, even above newer entries; `openQuestion(entries)` (`conversations/open-question.ts`) returns the last such question and both `FeedList` and `deriveTeam` use it. A closed question shows only the asker and the question text. `data-question-id` marks the card.
- While a turn runs, the feed shows `WorkingIndicator` (three dots and a shimmering "Working…", still under `prefers-reduced-motion`) from the first moment until a step, the draft or a question takes its place; a running `ActivityGroup` carries the same dots and label. The keyframes live in `index.css`.

## Team presentation

**The feed is the history; the right panel is the present moment.** The conversation grows without limit, so the
panel never does: it holds one station per role and no per-entry data, and everything that happened lives in the feed.

- `agentIdentity(role, roleName)` (`lib/agent-identity.ts`) gives each role its `mark` id, plain-language label, tagline, `stage` (Leads, Idea, Plan, Build, Review, Test, Ship; "Helps" for unknown roles), `responsibility`, example request and color token (`--agent-<role>` in `index.css`, light and dark). A role outside the team gets the generic mark and a color derived from its name. A stage is the role's specialty, never progress: the Coordinator may delegate to any role in any order.
- `AgentMark` (`components/agent/`) is the round lens with a custom SVG glyph per role (`generic` for unknown roles), a done or failed badge, a working glow and a waiting glow in the attention color; its accessible name is `"<label>, <state>"`. The per-glyph keyframes live in `index.css` and run only under `prefers-reduced-motion: no-preference`.
- `deriveTeam(entries, running)` (`conversations/team-state.ts`) turns the entries into one `TeamMember` per role for the current turn plus the delegations still open from earlier turns (a `user_message` drops the closed ones, because the coordinator accepts new messages while delegates keep running; open ones stay `working` while a turn runs and keep counting their steps, other agents count only the current turn). A `finished`, `failed` or `cancelled` entry closes the delegation with the same `delegationId`; a cancelled agent is `idle` and its handoff row reads "Stopped", whatever turn runs later. The members are: `working`, `waiting` (the asker of the `openQuestion`, by `askerRole`, whatever entries follow it), `done`, `failed` or `idle`, with the CEO's `summary`, project, start time, duration, step count and last action. The coordinator is `idle`, not `working`, while a delegate works or another agent has an open question. A delegation still open when no turn runs counts as stopped. Roles the turn did not involve stay `idle`.
- `SquadPanel` (`components/squad/`) renders the roster: the seven team roles (Coordinator, Product Owner, Tech Lead, Developer, Reviewer, QA, Git Ops, in `TEAM_ROLES` order, which `TeamIntro` follows too) plus an unknown role only if it was delegated to in the current turn. A `Station` has the mark, name, stage, time, the role's profile from the conversation (`profileSummary`, `lib/role-profile.ts`: "agent · model · effort", "Not configured", and "not installed" for a missing CLI; the settings sheet uses the same summary), a summary clamped to two lines and one ticker line with the latest action. The Coordinator reads "Coordinating the squad" and looks active while delegates work, "Thinking" when it works itself. Selecting a station reveals only its static `responsibility`. The header carries the live tally (`squadStatus`), which also labels the Squad tab. The panel scrolls only when the window is shorter than the roster, and resets with each new user message.
- The spine is a neutral line through the lens centers (`useSquadSpine`, positioned from measured lenses) and implies no order. `useSquadMotion` sends light pulses on short-lived elements animated with the Web Animations API: Coordinator to a working station on an interval, a bigger one when it starts and one back when it ends; each pulse removes itself on finish. Nothing runs under `prefers-reduced-motion` or without `Element.animate`.
- The delivery moment (`useDelivery`) counts a turn seen running here that delegated and ended with a completed answer; the panel then plays its flare and bloom once (`data-delivered`). A conversation opened with its turn already over never plays it.
- Focus: selecting a station or clicking an agent name in the feed sets the focus in `ConversationView`; it resets with the conversation (the view is keyed by id). The feed dims items of other agents (handled in `FeedItem`: handoffs and activity by role, `agent_response` and `interim` by CEO, `question` by `askerRole`; user messages and notices never dim) and a chip in the chat header, "<Agent> only ×", clears it. Hovering a feed item highlights its station.
- Layout (`ConversationView`): the chat column (centered, max 680 px) and the 420 px panel side by side; below 820 px of viewport they become two shadcn tabs, both kept mounted. Side by side, an `IconButton` in the chat header (next to Settings) collapses and restores the panel (`PanelRightClose`/`PanelRightOpen`, `aria-expanded`, `aria-controls="squad-panel"`, label "Hide squad panel" or "Show squad panel"). The collapsed `aside` stays mounted and `hidden`, so the panel keeps its state; the choice is kept by `useStoredFlag` (`lib/`, a boolean in `localStorage` under `arc.squadPanelOpen`, default open, in memory when storage throws). While collapsed, a dot on the toggle and the squad status in its label (`squadNeedsAttention`) show an agent waiting for the user or stopped work. The tabbed layout has no toggle.
- The answer that closes a turn that delegated carries "N agents · duration" in its footer (`TeamRecap` from `groupEntries`).
- `usePresence` sets the tab title, tints the page light with the active agent's color and, when the browser already granted permission, notifies a question while the tab is hidden. `AmbientGlow` is the light that follows the pointer (`usePointerGlow`: eased `requestAnimationFrame`, off for touch screens and reduced motion). An empty conversation shows `TeamIntro`, whose cards fill the composer (`Composer.initialText`).
- Every animation sits behind `motion-safe:` or a `prefers-reduced-motion: no-preference` query; `index.css` holds the keyframes.
