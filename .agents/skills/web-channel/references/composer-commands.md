# Composer commands

The commands that serve the composer: the prompt history, the `@` file search and the uploads of attachments.

## Prompt history

- `prompts.history` (with a `requestId`) answers the requester with `prompts.list`: the stored prompts, most recent first.
- The history is global to the machine, capped at `MAX_PROMPT_HISTORY`, never repeats the latest prompt, and is recorded by the server only (each accepted `message.send` with text); the client never appends.
- `JsonPromptHistoryAdapter` keeps the history in `<DATA_DIR>/web/prompt-history.json`; each append changes the file as it is on disk under its lock (`storage` module). An append that fails is logged and leaves the prompt out, without failing the message. A file that is not a list of strings is ignored.

## File search for `@` mentions

- File search is one session per connection (`WebFileSearchSessionsService`). The first `files.search { requestId, query }` with a new id replaces the connection's session and starts a walk of the workspace base directory; later ones with the same id only change the query; `files.close` (and the connection closing) stops the walk.
- Each update is a `files.results { requestId, items, walking }`: up to `MAX_MENTION_RESULTS` items `{ path, kind, matches }`, where `path` is relative to the base directory with `/` separators and a trailing `/` on directories, and `matches` are the indexes of the characters of `path` matched by the query. `walking` is `true` until the walk ends.
- The walk and the matching belong to the workspace module behind `IWorkspaceFileSearchPort`: `start(listener)` opens a `FileSearchSession` (`setQuery`, `stop`) over a listener (`onResults`, which replaces the previous results, and `onWalking`). Without a query the session lists the base directory, folders first.

## Uploads

- Uploads travel as frames, not HTTP, so every `IClientTransportPort` implementation carries them.
- `upload.start { uploadId, conversationId, name, size }` opens a writer (`IWorkspaceUploadPort.begin`) in `<workspace>/.arc-uploads/<conversationId>/` and answers `upload.ready`.
- The client then sends `upload.chunk { uploadId, index, dataBase64 }` one at a time (at most `UPLOAD_CHUNK_BYTES` raw bytes), each answered by `upload.ack { index }`.
- `upload.finish` answers `upload.done { attachment }` once the received bytes equal `size`; the attachment's path is the one the writer published, which keeps only the last path segment of the name and numbers a taken name (`a (1).png`).
- `WebUploadSessionsService` keeps the uploads per connection and answers `upload.failed { reason }`, discarding the partial file, for a size above `MAX_UPLOAD_BYTES`, an id in use, more than `MAX_CONCURRENT_UPLOADS` per connection, an out-of-order or oversized chunk, an incomplete file, an unknown id, or `UPLOAD_IDLE_TIMEOUT_MS` of silence. `upload.abort` and the connection closing discard it too.
