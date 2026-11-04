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
sends `turn.cancel`. The view follows new entries unless the user scrolled up.

## Theme

`ThemeProvider` keeps the choice (`'light' | 'dark' | 'system'`, default `'system'`) in `localStorage`
(`arc.theme`) and toggles the `dark` class on `<html>`; `system` follows `prefers-color-scheme` live. An inline
script in `index.html` applies the class before the first paint. `ThemeToggle` (a shadcn dropdown menu) sits in
the header. Style through the theme tokens so both modes work.
