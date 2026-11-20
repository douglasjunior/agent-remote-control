# Home

`/` without a conversation renders `HomePage` (`pages/home-page.tsx`), reached through `ConversationPage`. A centered column of at most 680 px; its width-dependent layout uses container queries (`@container`, `@md:`, `@xl:`), because the docked conversation list narrows the page.

## Sections

- **Greeting**: the CEO `AgentMark` as the brand mark and the heading "What should your squad build today?". There is no user name.
- **Composer**: `PromptInput` in the `inline` layout over `usePromptInput({ conversationId: null })`, labeled "Message", with the submit button "Start conversation". Enter sends, `ArrowUp` walks the prompt history and `@` mentions files. Attachments and audio need a conversation to upload to, so they are hidden and a line under the composer says they arrive once the conversation starts.
- **Squad picker** (`SquadPicker`, under the composer): a compact select labeled "Squad" with every squad (the default marked "(default)") and "Custom (inherit)". `useSquads` (`components/squads/`) asks `squads.list` on every `open` status and keeps the last `squads`. The picker is hidden until the list arrives and while it is empty. `resolveSquad` (`squad-choice.ts`) gives the squad shown: the one picked while it still exists, else the default squad, else `CUSTOM_SQUAD`.
- **Recent conversations** (`RecentConversations`): up to six of the most recently updated conversations that are not archived, as cards (title and relative time) that link to `/c/<id>`, one column that becomes two from `@xl`. "See all" calls `showConversations` of the outlet context. Without such a conversation the section is not rendered. The open task count is not shown: the board of a conversation reaches the client only when that conversation opens.

## Creating and sending

Sending needs a conversation id and the protocol has no command that sends to a conversation that does not exist, so the page creates it first with the same commands the rest of the app uses; the protocol is unchanged.

1. `sendInNewConversation({ text, squadId? })` (`ConversationsProvider`) keeps the message by request id and sends `conversation.create`. `squadId` is left out for "Custom (inherit)" and without squads. The composer stays locked (`starting`) until the page unmounts, and unlocks when the status leaves `open`, since the answer may have been lost.
2. On the matching `conversation.created` the provider navigates to `/c/<id>` and, without a squad, sends `message.send` at once.
3. With a squad it sends `squads.apply` and holds the message: the server runs the commands of a connection concurrently, so a `message.send` right behind it could start the turn with the settings the conversation would otherwise get. The message goes out on the `profiles` of that conversation whose `appliedSquad` is the chosen squad. An `error` for that conversation is toasted and the message is sent anyway, so the first message is never lost.

## Header

"New conversation" on `/` navigates to `/` with `homeFocusState()` (`focusComposer` in the router state); `HomePage` focuses the field when `homeFocusRequest` changes.
