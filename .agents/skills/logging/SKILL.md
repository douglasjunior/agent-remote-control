---
name: logging
description: >
  Server logging: Nest's Logger as the only logging API, the provider bound to IAppLoggerPort, conversation-tagged
  JSON log files in DATA_DIR/logs, what must stay out of them and how to inspect one conversation. Use when adding
  logs, changing the log provider or format, or diagnosing what happened in a conversation.
---

# Logging

> **Maintaining this skill**
>
> Update this document whenever the provider, the record format, the file location or a logging rule changes.

## Rules

- Log with Nest's `new Logger(ClassName.name)`. Do not use `console.*` or a logging library directly: `main.ts` installs the provider bound to `IAppLoggerPort` with `app.useLogger`, and every `Logger` follows it.
- To change the provider, bind another `LoggerService` to `IAppLoggerPort` in `logging.module.ts`. Nothing else changes.
- `ConversationLogContextService.run(conversationId, work)` (`logging/services/conversation-log-context.service.ts`, exported by `LoggingModule`) tags everything logged inside `work`, across awaits, through `AsyncLocalStorage`. It wraps `ExecuteAgentTurnUseCase.execute` for every channel and each web command with a `conversationId`. A provider reads the tag with `current()`. Do not repeat the id by hand in new log messages.
- What the user wrote stays out of log messages: log the command type or a short preview at most. Commands are logged by type.
- A message that carries a secret goes through a context in `CONSOLE_ONLY_CONTEXTS`, because log files get shared. The startup access token and the remote link, which carries it, do.

## Files

`FileConsoleLoggerAdapter` prints like Nest's console logger and appends to `DATA_DIR/logs/server-YYYY-MM-DD.jsonl` (UTC day, mode `0600`), written synchronously so a killed process loses nothing. Files older than the `LOG_RETENTION_DAYS` setting (default 14), read from `IRuntimeSettingsPort` each time, are removed when a new day's file opens. Each line is:

```json
{"at":"2026-03-10T12:00:00.000Z","level":"log","context":"UserQuestionQueueService","conversationId":"web-1","message":"[Questions Discarded] ...","stack":"only on errors"}
```

## Inspecting a conversation

```bash
grep -h '"conversationId":"<id>"' "$DATA_DIR"/logs/server-*.jsonl
```

Compare it with the entries the client received, kept in the database:

```bash
sqlite3 "$DATA_DIR/arc.sqlite" "SELECT payload FROM conversation_entry WHERE conversation_id = '<id>' ORDER BY position"
```

Useful markers: `[Command]`, `[Command Rejected]`, `[Conversation State]`, `[Delegation Started]`, `[Delegation Finished]` (prompts, prompt characters and tokens of the delegation), `[Delegation Restarted]`, `[Agent Prompt]`, `[Agent Usage]`, `[Agent Response]`, `[Agent Response Text]`, `[Stream Trace]`, `[Stream Chunk Shapes]`, `[Agent Requests]`, `[Agent Request Failed]`, `[Stray Requests]`, `[Protocol Repair]`, `[Board Check]`, `[Questions Queued]`, `[Questions Answered]`, `[Questions Discarded]`.

## Agent stream lines

Each prompt round writes these at the `log` level, with the conversation tag, so a response can be traced back to the chunks of the agent that produced it:

- `[Agent Response Text] Role=CEO, Length=601:` followed on the next lines by the whole response, as `[Agent Response]` (which keeps the 100-character preview) saw it. It is the agent's own text, so it does not fall under the rule about what the user wrote; a response that quotes the user can still be in it.
- `[Stream Trace] Agent=antigravity, Session=<acp session>, Events=<events>` (`AbstractAcpAdapter`, when the round stops, cancelled rounds included): the events the demux saw, in order, capped at 200 with `... +N more`, or `none`. A run of chunks of one message is `msg(id=abc,chunks=12,chars=601,sha=1a2b3c4d)` (`thought(...)` for reasoning, whose id ends in `:thought`), with `id=synthetic:N` when the agent sent no `messageId` and `again` appended when the same id had chunks earlier in the round. Each `tool_call` is `tool(id=t1,title="artifact_update")`. `chars` and `sha` (first 8 hex characters of the SHA-1) are those of the trimmed text of the run, so identical copies share a `sha`.
- `[Stream Chunk Shapes] Agent=..., Session=..., Shapes=shape(id=abc,update=agent_message_chunk,messageId=present,content=text) ...`: one entry per message id, from its first chunk, telling whether the agent sent a `messageId`.

```bash
grep -h '"conversationId":"<id>"' "$DATA_DIR"/logs/server-*.jsonl | grep -E 'Stream Trace|Stream Chunk Shapes|Agent Response'
```
