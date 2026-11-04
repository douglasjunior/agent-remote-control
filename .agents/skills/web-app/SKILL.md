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
└── lib/utils.ts             # shadcn cn()
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
| `agent_response` | Markdown with footer `roleName · agentName · modelName · effortName`; `failed` shows `errorMessage`; `cancelled` shows a muted label |
| `interim` | Muted markdown |
| `delegation` | Compact card ("X started", "X finished in N s") with the response in a collapsible |
| `thought`, `tool` | Consecutive runs grouped in one collapsible, closed by default: "Working… (N steps)" while the turn runs and the group is last, otherwise "Show details (N steps)"; `removed` thoughts are hidden |
| `question` | Card with one button per option (1-based `optionIndex`) and a text field; "Question n of m" when `total > 1`; only the latest question is enabled |
| `notice` | Inline line styled by `level` |

The composer is disabled while the connection is not `open` or the conversation is not `configured`
(the settings sheet then opens by itself). It stays enabled while a turn runs, next to a Stop button that
sends `turn.cancel`. The view follows new entries, and the growth of the draft, unless the user scrolled up.

The response being written arrives as `conversation.draft` events (`ConversationView.draft`, set by the reducer
and by `conversation.history`) and shows as Markdown after the last entry, where the delivered response replaces
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

`FileMentionPopup` is composed from tokens, not a shadcn `command`, because the field must keep the focus.

## Theme

`ThemeProvider` keeps the choice (`'light' | 'dark' | 'system'`, default `'system'`) in `localStorage`
(`arc.theme`) and toggles the `dark` class on `<html>`; `system` follows `prefers-color-scheme` live. An inline
script in `index.html` applies the class before the first paint. `ThemeToggle` (a shadcn dropdown menu) sits in
the header. Style through the theme tokens so both modes work.

- `QuestionCard` shows the asker with its project, the question's `message`, text and rationale ("Why it matters"), as every channel does. Only the last entry of a conversation can be answered; any entry after a question closes it, leaving the asker and the question text.
