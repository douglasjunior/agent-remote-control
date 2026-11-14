# Conversation feed

## Entry rendering

| Entry | Rendering |
|---|---|
| `user_message` | Right-aligned bubble; its attachments render as read-only chips in the bubble |
| `agent_response` | Agent mark and clickable colored name, Markdown, and a footer `roleName · agentName · modelName · effortName`; `failed` shows `errorMessage`; `cancelled` shows a muted label |
| `interim` | Muted markdown under the CEO's mark and name |
| `delegation` | One handoff row per delegation (`started` joined with its `finished` or `failed` entry by `delegationId`, never by round and role, which repeat across turns): agent mark, the CEO's `summary` as the title, the agent's name below, the live time or the duration; delegations of the same round that follow each other with no other entry between them stack as one squad. A chevron opens the CEO's `prompt` (a tinted block that scrolls past 240 px; empty entries from older histories show nothing), then the agent's steps, then its response or error |
| `thought`, `tool`, `skill` | Consecutive runs of one agent (`role`) grouped in one collapsible, closed by default and headed by the agent's name and what it does now (`toolLabel` turns tool titles into plain words); steps of a delegated agent go inside its delegation row instead; `removed` thoughts are hidden. A `skill` step reads "Read the skill", "Created the skill" or "Updated the skill" ("Could not read/write the skill" with the error as its title when it failed), each name linking to `/skills/<name>`, and `stepLabel` gives the group and the squad "Reading a skill" or "Writing a skill" |
| `question` | Card with an attention border, titled by the asker's name, with one button per option (1-based `optionIndex`) and an inline `PromptInput` for an answer of its own, with attachments and voice; "Question n of m" when `total > 1`; only the open question (`closed: false`) is enabled; a closed one keeps the asker and the text |
| `notice` | Inline line styled by `level` |

## Questions

- `QuestionCard` shows the asker with its project, the question's `message`, text and rationale ("Why it matters"), as every channel does. A closed question shows only the asker and the question text. `data-question-id` marks the card.
- The question the server has not closed (`closed: false`) can be answered wherever it sits in the feed, even above newer entries; `openQuestion(entries)` (`conversations/open-question.ts`) returns the last such question and both `FeedList` and `deriveTeam` use it.
- While the open question carries `timeout`, the card shows a `role="timer"` countdown (`m:ss`, a shadcn `Progress` bar that drains over `timeout.durationMs`, turning destructive in the last 30 s). The countdown runs from the absolute `expiresAt`, so a reload or reconnect shows the true time left.
- The option at `recommendedIndex` carries a `Recommended` badge.

## FeedList and scrolling

- `FeedList` (`components/entries/`) renders the entries with `react-virtuoso` inside the `message-viewport` div (`customScrollParent`), one `FeedItem` per grouped item. Off-screen rows are unmounted, so the open state of activity groups and handoff rows lives in `FeedList` (a set of item ids), not in the rows; so do the focus and the hover callbacks, which pass through the Virtuoso context.
- `useStickToEnd` keeps the viewport pinned to the end through a `ResizeObserver` on the viewport content, until the reader scrolls up; scrolling back within 24 px of the end resumes it, and so does a new `user_message`. While the reader is away from the end, an `IconButton` "Scroll to bottom" appears over the feed.
- `FeedList` follows the visible range through Virtuoso's `rangeChanged`. While an open question is outside it, a `WaitingLine` sits between the feed and the composer: "<Agent> is waiting for your answer" in the agent's color with a "Go to question" button, one line because only one question is open.
- The button and a click on a `waiting` station (besides its normal selection, switching to the Chat tab on a narrow window) call `FeedHandle.goToQuestion`: it releases `useStickToEnd` so the scroll away from the end is not undone, scrolls with `scrollToIndex` on the Virtuoso ref and focuses the card's first control.
- Specs that render the feed wrap it in `VirtuosoMockContext` (jsdom has no layout; `renderApp` already does) and fire the observer through a stubbed `ResizeObserver`. `VirtuosoMockContext` does not scroll, so specs of the go-to-question path replace `Virtuoso` with a stand-in that records `scrollToIndex` and reports a fixed range (`feed-list-scroll.spec.tsx`).

## Draft and working state

- The response being written arrives as `conversation.draft` events (`ConversationView.draft`, set by the reducer and by `conversation.history`) and shows as streaming Markdown (`isAnimating`) after the last entry, where the delivered response replaces it. While a draft shows, the grouped steps do not read "Working…".
- While a turn runs, the feed shows `WorkingIndicator` (three dots and a shimmering "Working…", still under `prefers-reduced-motion`) from the first moment until a step, the draft or a question takes its place; a running `ActivityGroup` carries the same dots and label. The keyframes live in `index.css`.
- The "Working…" indicator stays hidden only while the last entry is itself the open question.
