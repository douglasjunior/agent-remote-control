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
- A message that carries a secret goes through a context in `CONSOLE_ONLY_CONTEXTS`, because log files get shared. The startup access token does.

## Files

`FileConsoleLoggerAdapter` prints like Nest's console logger and appends to `DATA_DIR/logs/server-YYYY-MM-DD.jsonl` (UTC day, mode `0600`), written synchronously so a killed process loses nothing. Files older than `LOG_RETENTION_DAYS` (default 14) are removed when a new day's file opens. Each line is:

```json
{"at":"2026-03-10T12:00:00.000Z","level":"log","context":"UserQuestionQueueService","conversationId":"web-1","message":"[Questions Discarded] ...","stack":"only on errors"}
```

## Inspecting a conversation

```bash
grep -h '"conversationId":"<id>"' "$DATA_DIR"/logs/server-*.jsonl
```

Compare it with `DATA_DIR/web/history/<id>.json`, the entries the client received. Useful markers: `[Command]`, `[Command Rejected]`, `[Conversation State]`, `[Delegation Started]`, `[Delegation Finished]`, `[Delegation Restarted]`, `[Questions Queued]`, `[Questions Answered]`, `[Questions Discarded]`.
