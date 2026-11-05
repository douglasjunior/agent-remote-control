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
├── connection/              # IServerConnection, WebSocket implementation, access token, context
├── conversations/           # reducer, context and entry grouping
├── theme/                   # ThemeProvider and useTheme (light, dark, system)
├── pages/                   # route-level screens
├── components/              # app components; components/ui is vendored shadcn
│   ├── agent/               # AgentMark: the round lens with an animated glyph per role
│   ├── squad/               # SquadPanel (right panel), Station, spine and motion hooks, squad status
│   ├── usage/               # UsageIndicator (header), UsagePanel, useAgentQuota, quota levels
│   └── entries/             # feed rows: handoff rows, activity groups, messages, questions
└── lib/                     # cn(), agent-identity (mark, color, stage, responsibility per role), tool-label, formatting, clocks, media query
```

## Connection

- Components depend on `IServerConnection` (`connect`, `disconnect`, `send`, `onEvent`, `onStatus`), never
  on `WebSocket`, so another transport can replace `WebSocketServerConnection`. Status is
  `'connecting' | 'open' | 'unauthorized' | 'closed'`; `onEvent` and `onStatus` return an unsubscribe function.
- `WebSocketServerConnection` always connects to the relative `/ws` (`wss` on https), sends `auth` first and
  reports `open` on `auth.ok`. `auth.failed` or close code `4401` clears the stored token, reports
  `unauthorized` and stops. Other closes reconnect with exponential backoff from 500 ms to a 10 s cap, reset
  after a successful auth. Commands sent while not `open` are queued and flushed after `auth.ok`. Every frame
  goes through `parseServerEvent`; invalid frames are dropped with `console.warn`.
- `ConnectionProvider` owns the token state and the connection lifecycle: it connects when a token exists and
  exposes `status`, `hasToken` and `submitToken` through `useConnection()`. Without a token (or after
  `unauthorized`) `AppLayout` renders `MissingTokenPage`.
- The token lives in `localStorage` (`arc.accessToken`). A `#token=` URL fragment replaces it and is removed
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
  commands and lets the test emit events and statuses.
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

## Entry rendering

| Entry | Rendering |
|---|---|
| `user_message` | Right-aligned bubble |
| `agent_response` | Agent mark and clickable colored name, Markdown, and a footer `roleName · agentName · modelName · effortName`; `failed` shows `errorMessage`; `cancelled` shows a muted label |
| `interim` | Muted markdown under the Coordinator's mark and name |
| `delegation` | One handoff row per delegation (`started` joined with its `finished` or `failed` entry by `delegationId`, never by round and role, which repeat across turns): agent mark, the CEO's `summary` as the title, the agent's name below, the live time or the duration; delegations of the same round that follow each other with no other entry between them stack as one squad. A chevron opens the CEO's `prompt` (a tinted block that scrolls past 240 px; empty entries from older histories show nothing), then the agent's steps, then its response or error |
| `thought`, `tool` | Consecutive runs of one agent (`role`) grouped in one collapsible, closed by default and headed by the agent's name and what it does now (`toolLabel` turns tool titles into plain words); steps of a delegated agent go inside its delegation row instead; `removed` thoughts are hidden |
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
into the field uploads at once through `uploadFile`, which depends only on `IServerConnection` (chunks of
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

`UsageIndicator` (`components/usage/`) sits in the header next to the connection badge: one vertical meter per agent, in the server's order, each at the agent's closest limit (`tightestFraction`), then the lowest percent left in mono. An agent without numbers shows an empty track; with no reports yet the tracks pulse and the text is `–`. The accessible name carries the percent. Levels match the Discord `/usage` (`quotaLevel`: `good` from 50%, `attention` from 20%, `critical` below, drawn with `--good`, `--attention` and `--destructive`).

A click opens `UsagePanel` in a shadcn `Popover`, built to be read at a glance: one line per bucket in columns aligned across the agents under a "Limit, Left, Resets" header, with the label, a thin bar, the percent left and a compact time until the reset (`formatCountdown`; the full sentence is the `title` and the screen reader text), left out once it has passed. Color marks what needs attention: a percent stays in the foreground color while `good`, and a `critical` row is tinted. `bucketLabel` names a bucket by its window and adds the qualifier from its name when a sibling shares that window (`Week · Sonnet only`). A group is named only when the agent has more than one; an agent without numbers takes one line, with "No usage data" or "Could not read usage". A row never moves on refresh, because the order is the server's.

`useAgentQuota` holds the numbers outside the conversations reducer, since only this indicator reads them. It sends `quota.get` when the status becomes `open`, every `QUOTA_REFRESH_MS` (5 minutes) while the tab is visible, and on returning to the tab when the numbers are that old; the panel's refresh button sends `refresh: true`. Each query starts the agents' CLIs, so keep this rate low. The last numbers stay on screen through a refresh, a `quota.failed` ("Could not refresh") or a lost connection.

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

- `agentIdentity(role, roleName)` (`lib/agent-identity.ts`) gives each role its `mark` id, plain-language label, tagline, `stage` (Leads, Idea, Plan, Build, Review, Ship; "Helps" for unknown roles), `responsibility`, example request and color token (`--agent-<role>` in `index.css`, light and dark). A role outside the team gets the generic mark and a color derived from its name. A stage is the role's specialty, never progress: the Coordinator may delegate to any role in any order.
- `AgentMark` (`components/agent/`) is the round lens with a custom SVG glyph per role (`generic` for unknown roles), a done or failed badge, a working glow and a waiting glow in the attention color; its accessible name is `"<label>, <state>"`. The per-glyph keyframes live in `index.css` and run only under `prefers-reduced-motion: no-preference`.
- `deriveTeam(entries, running)` (`conversations/team-state.ts`) turns the entries into one `TeamMember` per role for the current turn plus the delegations still open from earlier turns (a `user_message` drops the closed ones, because the coordinator accepts new messages while delegates keep running; open ones stay `working` while a turn runs and keep counting their steps, other agents count only the current turn). A `finished`, `failed` or `cancelled` entry closes the delegation with the same `delegationId`; a cancelled agent is `idle` and its handoff row reads "Stopped", whatever turn runs later. The members are: `working`, `waiting` (the asker of the `openQuestion`, by `askerRole`, whatever entries follow it), `done`, `failed` or `idle`, with the CEO's `summary`, project, start time, duration, step count and last action. The coordinator is `idle`, not `working`, while a delegate works or another agent has an open question. A delegation still open when no turn runs counts as stopped. Roles the turn did not involve stay `idle`.
- `SquadPanel` (`components/squad/`) renders the roster: the six team roles plus an unknown role only if it was delegated to in the current turn. A `Station` has the mark, name, stage, time, a summary clamped to two lines and one ticker line with the latest action. The Coordinator reads "Coordinating the squad" and looks active while delegates work, "Thinking" when it works itself. Selecting a station reveals only its static `responsibility`. The header carries the live tally (`squadStatus`), which also labels the Squad tab. The panel scrolls only when the window is shorter than the roster, and resets with each new user message.
- The spine is a neutral line through the lens centers (`useSquadSpine`, positioned from measured lenses) and implies no order. `useSquadMotion` sends light pulses on short-lived elements animated with the Web Animations API: Coordinator to a working station on an interval, a bigger one when it starts and one back when it ends; each pulse removes itself on finish. Nothing runs under `prefers-reduced-motion` or without `Element.animate`.
- The delivery moment (`useDelivery`) counts a turn seen running here that delegated and ended with a completed answer; the panel then plays its flare and bloom once (`data-delivered`). A conversation opened with its turn already over never plays it.
- Focus: selecting a station or clicking an agent name in the feed sets the focus in `ConversationView`; it resets with the conversation (the view is keyed by id). The feed dims items of other agents (`entryAgent`: handoffs and activity by role, `agent_response` and `interim` by CEO, `question` by `askerRole`; user messages and notices never dim) and a chip in the chat header, "<Agent> only ×", clears it. Hovering a feed item highlights its station.
- Layout (`ConversationView`): the chat column (centered, max 680 px) and the 420 px panel side by side; below 1108 px of viewport (820 px beside the conversation list) they become two shadcn tabs, both kept mounted.
- The answer that closes a turn that delegated carries "N agents · duration" in its footer (`TeamRecap` from `groupEntries`).
- `usePresence` sets the tab title, tints the page light with the active agent's color and, when the browser already granted permission, notifies a question while the tab is hidden. `AmbientGlow` is the light that follows the pointer (`usePointerGlow`: eased `requestAnimationFrame`, off for touch screens and reduced motion). An empty conversation shows `TeamIntro`, whose cards fill the composer (`Composer.initialText`).
- Every animation sits behind `motion-safe:` or a `prefers-reduced-motion: no-preference` query; `index.css` holds the keyframes.
