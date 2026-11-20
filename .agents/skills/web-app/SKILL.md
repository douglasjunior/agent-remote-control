---
name: web-app
description: >
  React web app in packages/web: folder layout, the IServerConnection interface and its WebSocket and
  WebRTC implementations, the p2p build, the connection badge, access token handling, conversation state, the feed and composer, the mission
  board, the squad panel, usage and agent login indicators, the skills page, the squads page, the settings page, the import convention,
  testing with Testing Library and fake connections, and vendored shadcn/ui components. Use when
  working with the web package, React components, the browser connection to the server or the
  access token form.
---

# Web app

> **Maintaining this skill**
>
> Update this document whenever any rule described here changes. The criterion is not
> *which* rule — it is the nature of the change: a layout, connection, import or testing rule
> changed → update; a visual tweak that preserves the described behavior → leave it alone.

`packages/web` (`@agent-remote-control/web`) is a React + Rsbuild + React Router + Tailwind v4 + shadcn/ui
app. It talks to the server only through `@agent-remote-control/protocol`, over a WebSocket.

## Layout

```text
packages/web/src/
├── main.tsx                 # bootstrap: ConnectionProvider + RouterProvider
├── router.tsx               # route table (`routes`) and the browser router
├── connection/              # IServerConnection, ChannelServerConnection and its WebSocket and WebRTC transports, remote link, AccessTokenStore, context
├── conversations/           # reducer, context, entry grouping, open question, team state, presence, conversation paths
├── artifacts/               # the mission board of each conversation: reducer, context, useBoard, tree helpers, labels, paths
├── theme/                   # ThemeProvider and useTheme (light, dark, system)
├── pages/                   # route-level screens
├── test/                    # FakeServerConnection, renderApp, feed providers, fixtures
├── components/              # app components; components/ui is vendored shadcn
│   ├── agent/               # AgentMark: the round lens with an animated glyph per role
│   ├── squad/               # SquadPanel (right panel), Station, spine and motion hooks, squad status
│   ├── usage/               # UsageIndicator (header), UsagePanel, useAgentQuota, quota levels
│   ├── auth/                # AgentAuthController (toasts), AgentAuthPopover (header), AgentLoginCard, useAgentAuthStatus
│   ├── artifacts/           # ArtifactBoard (list and kanban), ArtifactPane and ArtifactDetail, create dialog, properties, activity
│   ├── skills/              # SkillList, SkillDetail, SkillRoles and the skill paths of the skills page
│   ├── squads/              # SquadList, SquadEditor, the squad paths and the roles a squad can set
│   ├── settings/            # RoleEditor (agent, model and effort), RoleForm and the option lists, shared by the settings sheet and the squad editor
│   ├── server-settings/     # the settings page: SettingField, drafts and their checks, texts, the Discord connection test
│   ├── prompt-input/        # PromptInput and its hooks: history, file mentions, attachments, voice
│   └── entries/             # feed rows: handoff rows, activity groups, messages, questions, retries
└── lib/                     # cn(), agent-identity (mark, color, stage, responsibility per role), tool-label, formatting, clocks, media query, useStoredFlag
```

## App shell

- `AppLayout` renders a header (a `PanelLeftOpen`/`PanelLeftClose` `IconButton` "Show conversations"/"Hide conversations" with `aria-expanded`, the primary "New conversation" button, the truncating `h1`, then the Skills and Settings links (icon links with a tooltip, to `/skills` and `/settings`), the agent logins popover, usage indicator, connection badge and theme toggle on the right) above the page. It also mounts the sonner `Toaster` once, so every toast of the app and of the specs renders.
- From 768 px of viewport the conversation list is a docked `aside` (`id="conversation-list"`, 288 px) that pushes the page; it stays mounted and `hidden` while closed, defaults to closed and the choice is kept by `useStoredFlag` under `arc.conversationListOpen`. Below 768 px the same toggle opens `ConversationList` in a left shadcn `Sheet` (not persisted), which picking a conversation closes (`onNavigate`).
- "New conversation" lives only in the header and the empty state of `ConversationPage`. Below `sm` the header drops the `h1`, shows "New conversation" and the connection badge as icons only, tightens its gaps and hides the Skills and Settings links and the theme toggle behind one "More" `IconButton` (`HeaderMenu`, a dropdown menu with the two links and the theme choices), keeping the agent logins, usage and connection indicators in view, so every control fits from 320 px. The switch is CSS only (`sm:hidden`, `hidden sm:inline-flex`).
- `useStoredFlag` (`lib/`) keeps a UI boolean in `localStorage` under an `arc.*` key, in memory when storage throws.

## Connection

- Components depend on `IServerConnection` (`transport`, `connect`, `disconnect`, `send`, `onEvent`, `onStatus`, `onTransport`,
  `hasAccessToken`, `setAccessToken`), never on a transport. Status is `'connecting' | 'open' | 'unauthorized' | 'closed' |
  'incompatible' | 'untrusted'`; transport is `'websocket' | 'webrtc' | 'turn'`. The `on*` methods return an unsubscribe function.
  `hasAccessToken()` says whether a token is at hand (in storage or in a link the page was opened with)
  and `setAccessToken(token)` keeps the one the user typed.
- `ChannelServerConnection` holds the rules every transport shares; a subclass only opens one attempt (`openChannel`,
  given the stored token) and
  reports through `ChannelHandlers` (`onOpen`, `onMessage` with one whole JSON text, `onClose` with a reason, `onTransport`).
  It sends `auth` first and reports `open` on `auth.ok`. `auth.failed` or an `unauthorized` close clears the stored token,
  reports `unauthorized` and stops; `incompatible` and `untrusted` stop too. Other closes reconnect with exponential
  backoff from 500 ms to a 10 s cap, reset after a successful auth, and at once when the page becomes visible again.
  Commands sent while not `open` are queued and flushed after `auth.ok`. Once authenticated it sends `ping` every 5 s
  when none is pending; anything from the server answers it (`pong` is not forwarded), a frame of a message still
  arriving included (`ChannelHandlers.onProgress`), since the `pong` waits behind that message; a ping unanswered for 10 s drops the
  connection into the reconnection, since a vanished network closes no socket. Every message goes through `parseServerEvent`;
  invalid ones are dropped with `console.warn`. Reports of a replaced attempt are ignored.
- `WebSocketServerConnection` always connects to the relative `/ws` (`wss` on https); close code `4401` is `unauthorized`.
- `WebRtcServerConnection` reaches a host through the signaling server of the page and a data channel, both ways in
  frames. Each attempt generates an ECDSA certificate (`RTCPeerConnection.generateCertificate`), reads its fingerprint
  from a throwaway offer and sends `client.connect` with `sessionProof(token, instance id, fingerprint)`; the offer, made
  with that certificate, waits for `client.accepted`. `client.rejected` (the host refused the proof) is `unauthorized`.
  Attempts leave the TURN URLs out until one fails to connect (no channel 8 s after its offer, or a failed peer
  connection); from then on, for the life of the page, they take the relay.
  It refuses an answer whose certificate fingerprint is not the pinned one (`untrusted`) and a host of another
  `PROTOCOL_VERSION` (`incompatible`), and turns its transport to `turn` when the selected candidate pair is relayed.
- `createAppConnection(import.meta.env.ARC_TARGET)` picks the transport in `main.tsx`: the `p2p` target (`--env-mode p2p`,
  `build:p2p` into `dist-p2p`) is the hosted web app, which reads the remote link (`readRemoteLink`: instance id from
  `/i/<instance id>`, fingerprint from the `fp` fragment parameter, kept as `arc.remote.<id>.fingerprint`, and ignored,
  from the link or from storage, unless it derives the instance id), uses the
  router basename `/i/<instance id>` and a token store per instance, and renders `RemoteLinkMissingPage` without a link.
  The `server` target reaches the server that serves the page over WebSocket. `rsbuild.config.ts` defines
  `import.meta.env.ARC_TARGET` from the env mode, because `--env-mode` leaves `import.meta.env.MODE` untouched.
- `ConnectionProvider` owns the token state and the connection lifecycle: it asks the connection for the token
  (`hasAccessToken`, `setAccessToken`), connects when one exists and
  exposes `status`, `transport`, `hasToken` and `submitToken` through `useConnection()`. Without a token (or after
  `unauthorized`) `AppLayout` renders `MissingTokenPage`.
- `ConnectionBadge` shows the status with an icon of the transport (`Cable`, `ArrowLeftRight`, `Waypoints`); its
  popover, opened on hover or click, explains the transport and why an `incompatible` or `untrusted` host was refused.
- `AccessTokenStore` (`connection/access-token-store.ts`) keeps the token in `localStorage` under its key (`arc.accessToken`,
  or `arc.accessToken.<instance id>` for a remote host) with `read`, `store`, `clear` and `load`. `load` first takes the
  `token` fragment parameter into storage; `takeFragmentParam` removes the parameter it reads with
  `history.replaceState` and keeps the others. Every storage access is wrapped in `try/catch`.
- Rsbuild proxies `/ws` and `/health` to the server in `dev` and `preview` with `changeOrigin: false` (Rsbuild defaults it to `true`), so the server's origin check sees a same-origin request; the target port is the `PORT` of the root `.env` (default `3000`). In the `p2p` env mode it proxies `/signal` to the p2p-server on port 3100 instead. nginx proxies the same path in production.

## Imports and vendored UI

- Relative imports with the `.js` suffix, which Rsbuild resolves to `.ts`/`.tsx`. The `@/` alias is not used.
- `components/ui/**` is shadcn code kept as vendored source (style `base-nova`, Base UI); it is excluded from
  coverage. Look for a shadcn component before writing one, install it with the shadcn CLI and restore
  relative imports after each CLI run.
- Never disable lint rules globally to make generated code pass.

## Tests

- Specs sit next to the file under test (`*.spec.ts`, `*.spec.tsx`) and run in the Rstest project `web`
  (jsdom, globals, the `@testing-library/jest-dom` matchers registered in `src/test/setup.ts`, and the Rsbuild config through `@rstest/adapter-rsbuild`).
- Use `FakeServerConnection` from `src/test/fake-server-connection.ts` for components; it records sent
  commands, lets the test emit events and statuses, and keeps the token in memory (`accessToken`, a token at the start;
  set it to `null` for a signed-out spec).
- The browser `WebSocket` and `RTCPeerConnection` are external I/O boundaries: stub them with `rs.stubGlobal` and fake timers.
- No spec prints "not wrapped in act": events from a fake go through `act` (`await act(async () => ...)` when they
  settle a promise), waits use `waitFor`/`findBy*` from `@testing-library/react` (never `rs.waitFor` in a spec that
  renders React), interactions go through `user-event`, and a spec that interacts or waits keeps `setTimeout` real (fake
  timers cover only the clock the code reads, never with `shouldAdvanceTime`). Read
  [references/testing.md](references/testing.md) before writing or fixing a component or hook spec.
- Specs that render the feed wrap it in `VirtuosoMockContext` (`renderApp` already does); the scrolling specs are described in [references/conversation-feed.md](references/conversation-feed.md).
- Target 100% coverage outside `components/ui`.

## Conversation state

- `conversationsReducer` is a pure reducer from `ServerEvent` to `ConversationsState` (`list` ordered by
  `updatedAt` desc, `agents`, and `byId` with `entryIds`, `entries`, `positions`, `start`, `state`, `loaded`,
  `configured`, `profilesLoaded`, `profiles`, `appliedSquad`, `customized`). The view holds a window of the history, ordered by position, from
  `start`. `conversation.history` replaces the window with the latest page, keeping only the entries already held
  past its end (published after the server read the page); `conversation.entries` puts an earlier page before the
  window when it ends where the window starts, and is ignored otherwise; `conversation.entry` replaces a held entry
  in place, places a new one by its position, and leaves out an entry before the window, which its page carries as
  it is now. A change that leaves a view as it was returns the same state. Events that carry no state
  (`models.list`, `efforts.list`, `error`, auth) leave it untouched; the settings sheet listens to them
  through `connection.onEvent`.
- State that only one feature reads (the board, usage, agent logins) lives in its own provider or hook, outside
  the conversations reducer.
- `ConversationsProvider` lives inside the router (`AppLayout`). It sends `conversation.list` on every `open`
  status, and navigates to `/c/<id>` on the `conversation.created` whose `requestId` it generated.
  `ConversationView` sends `conversation.history` and `profiles.get` whenever the status is `open` or the
  conversation changes, `agents.list` while no agents are known, and `profiles.get` again on every `squads`, since a
  squad saved or deleted changes whether the conversation still matches the squad it applied. `useEarlierEntries` sends
  `conversation.entries` with `before: start` while `start > 0`, once per position, again after a lost connection;
  its `load` decides from refs, since Virtuoso's `startReached` keeps the callback it holds and may call it in the same
  tick as a click.

## Theme and motion

- `ThemeProvider` keeps the choice (`'light' | 'dark' | 'system'`, default `'system'`) in `localStorage`
  (`arc.theme`) and toggles the `dark` class on `<html>`; `system` follows `prefers-color-scheme` live. An inline
  script in `index.html` applies the class before the first paint. `ThemeToggle` (a shadcn dropdown menu) sits in
  the header. Style through the theme tokens so both modes work.
- Scrollbars are styled once, in the base layer of `index.css`, for every scrolling element: a thin floating thumb on a transparent track, from `--scrollbar-thumb` and `--scrollbar-thumb-hover`. A component adds no scrollbar styling of its own; `scrollbar-width` or `scrollbar-color` on an element turn the `::-webkit-scrollbar` rules off in Chromium, so those properties apply only where the pseudo-elements do not exist.
- Every animation sits behind `motion-safe:` or a `prefers-reduced-motion: no-preference` query; `index.css` holds the keyframes.

## Feature areas

Each area below has a reference with its components, states and exact texts. Read the reference before changing that area.

- **Conversation list**: rows ordered by recency, Rename and Archive through `conversation.rename`/`conversation.archive`, an "Archived (n)" group, in-place `TitleInput`. Read [references/conversation-list.md](references/conversation-list.md) when touching the list or renaming.
- **Feed**: how each entry type renders, questions and the open question, the virtualized `FeedList` with stick-to-end and "Go to question", the streaming draft and the "Working…" indicator. Read [references/conversation-feed.md](references/conversation-feed.md) when touching `components/entries/`, question cards or feed scrolling.
- **Composer**: disabled until `open` and `configured`, Stop sends `turn.cancel`, prompt history, `@` file mentions, chunked attachments, voice recording, and the answer input of the question card. Read [references/composer.md](references/composer.md) when touching `components/prompt-input/` or the composer.
- **Mission board**: the conversation routes and `ConversationNav`, `ArtifactsProvider` and `useBoard`, the list and kanban views, the filters sheet, the create dialog, the artifact detail and frozen tasks. Read [references/mission-board.md](references/mission-board.md) when touching `artifacts/` or `components/artifacts/`.
- **Team presentation**: the feed is the history and the squad panel is the present moment; agent identity and `AgentMark`, `deriveTeam`, stations, focus, the panel layout, the squad route and presence. Read [references/team-presentation.md](references/team-presentation.md) when touching `components/squad/`, `components/agent/`, team state or agent colors.
- **Agent usage**: the header meters, the usage popover and the `quota.get` refresh cadence. Read [references/agent-usage.md](references/agent-usage.md) when touching `components/usage/`.
- **Agent logins**: the logins popover, the login state machine and the persistent per-agent toasts. Read [references/agent-logins.md](references/agent-logins.md) when touching `components/auth/`.
- **Settings page**: `/settings`, the sections and fields by kind, source badges, write-only secrets, drafts checked with the protocol schemas, "Save changes", "Reset to default", the restart notice and the Discord "Test connection". Read [references/settings-page.md](references/settings-page.md) when touching `components/server-settings/` or `SettingsPage`.
- **Squads page**: `/squads` routes, the list and the editor of a squad, the default squad, deleting, "Save as squad" and "Apply squad" in the conversation settings sheet. Read [references/squads-page.md](references/squads-page.md) when touching `components/squads/`, `SquadsPage`, `components/settings/` or the squad controls of `SettingsSheet`.
- **Skills page**: `/skills` routes, the list and detail, "Ask the CEO", deleting a custom skill and `startConversation(prompt)`. Read [references/skills-page.md](references/skills-page.md) when touching `components/skills/` or `SkillsPage`.
