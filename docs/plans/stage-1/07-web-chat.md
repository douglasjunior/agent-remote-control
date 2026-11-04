# 07 — Web: chat interface

**Model:** Sonnet 5.5 · **Effort:** medium · **Depends on:** 05 and 06

## Goal

Build the chat on top of the plan 06 scaffold:
- a conversation list;
- a conversation view streaming progress live;
- agent questions and agent/model menus as buttons;
- cancellation.

Technical detail (thoughts and tool calls) stays available but collapsed, so the screen reads well for non-developers while developers can still inspect it.

## Read first

`.agents/skills/web-app/SKILL.md`, `.agents/skills/web-channel/SKILL.md`, `packages/protocol/src/*` and `packages/web/src/connection/*`.

## State

`src/conversations/conversations-reducer.ts` is a pure reducer from `ServerEvent` to state, plus `conversations-context.tsx` exposing it with `useReducer`. It sends `conversation.list` on every `open` status and `conversation.history` when a conversation is opened or the connection reopens.

```ts
type ConversationsState = {
  readonly list: readonly ConversationSummary[];         // ordered by updatedAt desc
  readonly byId: Readonly<Record<string, {
    readonly entryIds: readonly string[];                // arrival order
    readonly entries: Readonly<Record<string, ConversationEntry>>;
    readonly state: ConversationState;
    readonly loaded: boolean;
  }>>;
};
```

- `conversation.entry` upserts: an existing id is replaced in place; a new id is appended.
- `conversation.history` replaces the conversation wholesale.
- The reducer is the core logic and gets exhaustive tests.

## Screens

- **Layout:** sidebar with a "New conversation" button and the list (title, relative time, a spinner while `running` or `queued`). On narrow screens the sidebar becomes a `sheet`. Creating a conversation sends `conversation.create` and navigates to `/c/<id>` on `conversation.created` with the matching `requestId`.
- **Conversation header:** title plus "Agent", "Model" and "Profiles" buttons (`config.open`).
- **Entry rendering:**

  | Entry | Rendering |
  |---|---|
  | `user_message` | Right-aligned bubble |
  | `agent_response` | Markdown (`react-markdown` + `remark-gfm`) with a footer `roleName · agentName · modelName · effortName`; `failed` shows `errorMessage` in an error style; `cancelled` shows a muted label |
  | `interim` | Markdown, muted |
  | `delegation` | Compact card: "Tech Lead started" / "Tech Lead finished in 42 s", with the response in a `collapsible` |
  | `thought`, `tool` | Consecutive runs grouped into one `collapsible` labeled "Working… (N steps)" while running and "Show details (N steps)" when done, closed by default. Tool rows show the title and a status icon; thoughts render as muted markdown; `removed` thoughts are hidden |
  | `question` | Card with the asker, the question, the rationale and one button per option sending its 1-based number with `message.send`; "Question 2 of 3" when `total > 1` |
  | `selection` | Card with one button per option sending `option.index`, a "Cancel" button sending `config.cancel`, and a warning style for `invalid` |
  | `notice` | Inline line styled by `level` |

- Only the latest `question` or `selection` keeps its buttons enabled; older ones render read-only.
- **Composer:** a `textarea` where Enter sends and Shift+Enter adds a newline. It is disabled while the connection is not `open`. While the conversation is `running` or `queued`, a "Stop" button sends `turn.cancel`; the composer stays enabled, because the orchestrator steers or queues follow-up messages.
- Auto-scroll to the bottom on new entries unless the user scrolled up.
- `/` with no conversation shows an empty state with the "New conversation" action.

## Tests

- Exhaustive reducer tests.
- Component tests with Testing Library and a fake `IServerConnection`: creation and navigation, history loading, the streaming upsert, grouping of activity, option buttons sending the right text, only the latest card active, the stop button, the disabled composer and the markdown footer.

## Skills

Update `web-app` with the state model and the entry rendering table.

## Acceptance

- `yarn ts`, `yarn lint`, `yarn test` and `yarn build` pass.
- **Manual run against a real agent:**
  - create a conversation, pick the agent and model with buttons, send a task;
  - watch steps stream in the collapsed group;
  - answer a question with a button;
  - stop a turn;
  - reload the page and see the history restored.

## Commit

`feat(web): add the chat interface`
