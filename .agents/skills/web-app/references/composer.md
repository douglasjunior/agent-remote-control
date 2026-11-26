# Composer and answer input

## Composer state and layouts

- The composer is disabled while the connection is not `open` or the conversation is not `configured` (the settings sheet then opens by itself). It stays enabled while a turn runs, next to a Stop button that sends `turn.cancel`.
- `ConversationView` keys the `Composer` by conversation id, so attachments and the draft never cross conversations.
- `usePromptInput` takes `conversationId: string | null`. `null` writes a message before its conversation exists (the home screen): uploads need a conversation, so the attachments report `enabled: false`, ignore added files, and `PromptInput` hides the paperclip, the microphone and the drop and paste handlers. History and mentions work without a conversation. `focus()` gives the field the focus.
- `usePromptInput` holds all of the below (text, attachments, recording, mentions, history) and `PromptInput` renders it, in two layouts: `block` with the tools around the field, used by `Composer`, and `inline` with field and tools in one frame, used inside the question card.
- The answer state lives apart from the field because the feed unmounts off-screen rows: `AnswerInputProvider` keeps it above `FeedList`, so a recording or an upload survives scrolling, and only the card reads the context, so typing does not render the feed. It resets when the open question changes.

## Prompt history

`usePromptHistory` (`components/prompt-input/`) gives the composer shell-like history: the first `ArrowUp` on the first line sends `prompts.history` and the navigation runs over the `prompts.list` answer (matched by `requestId`, 5 s timeout) until the message is sent. `ArrowDown` on the last line walks back to the text being typed. The server records prompts; the client never appends.

## File mentions

- `useFileMentions` opens a file list when the caret is on an `@` that begins a word. Each open list is one server search session: the hook generates a `requestId`, sends `files.search` with it (no wait for a bare `@`, 200 ms after typing a query), applies every `files.results` for that id (the list fills while `walking` is `true`) and sends `files.close` when the list closes.
- "Open" is derived from text, caret, focus and results; `Esc` dismisses the token until the caret leaves every mention. The highlight returns to the first item when the searched query changes, not when more results stream in.
- While the list is open the arrows, `Tab` and `Enter` belong to it, before the history and the send.
- A file is inserted as `@path ` (quoted when it has whitespace); a directory as `@dir/` with no space so the list goes into it.
- The popup highlights the characters listed in each item's `matches`, dims the folder part and shows a spinner while `walking`.
- `FileMentionPopup` is composed from tokens, not a shadcn `command`, because the field must keep the focus.

## Attachments

- `usePromptAttachments`: a file picked with the paperclip, dropped on the composer frame or pasted into the field uploads at once through the upload protocol inside `usePromptAttachments`, which depends only on `IServerConnection` (chunks of `UPLOAD_CHUNK_BYTES`, one `upload.ack` awaited per chunk, `upload.abort` on cancel, rejection when the status leaves `open`).
- Each file is a chip (`AttachmentChip`) that is `uploading`, `ready` or `error`; Send stays disabled while any is uploading, and the message carries the `ready` ones (text may be empty).
- A file above `MAX_UPLOAD_BYTES` fails without being sent, at most `MAX_ATTACHMENTS` are kept, and removing a chip cancels its upload.

## Voice recording

- `useVoiceRecorder`: the microphone button next to the paperclip asks for the microphone and records with `MediaRecorder` (webm/opus, ogg or mp4, whichever the browser supports).
- While recording, the field gives way to a timer with a discard button and an attach button, and Send and the paperclip are disabled.
- Attaching stops the recording and hands the audio `File` (`recording-<timestamp>.<ext>`) to `usePromptAttachments.addFiles`: it uploads like any file and waits as a chip until the message is sent.
- A denied microphone or a failed start shows an inline alert.
- A chevron attached to the microphone button opens a menu (`useMicrophones`) with "System default" and the audio inputs, the chosen one checked; opening it asks for microphone access once when the browser still hides device names. The choice is kept in `localStorage` (`arc.microphone`) and recording asks for that device exactly; a device that is gone falls back to the default.
- The microphone is released when the recording ends or the composer unmounts.
