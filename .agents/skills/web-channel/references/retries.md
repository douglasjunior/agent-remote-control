# Retries of a Failed Turn

When a round of the CEO fails, the orchestrator keeps the turn alive and waits to try again (see the orchestrator skill, "A Failed Round Waits to Be Retried"). The web channel shows the wait and passes the user's choice on; it runs no turn for it.

## Entries

- `onRetry` `scheduled` becomes a `retry` entry: `roleName`, `errorMessage`, `attempt` (the retry the wait leads to, from 1), `timeout` (`expiresAt` in epoch milliseconds plus `durationMs`) and `closed: false`. Every failure is a new entry, so the history keeps each one.
- `onRetry` `ended` closes the open retry entries of the conversation in place (`closed: true`, the same id), whatever ended the wait. `WebConversationEventsService` tracks the open ones in memory like the open questions (`closeOpenRetries`).
- A server restart loses the wait: opening the history closes the `retry` entries nothing waits for (`settleOrphanedRetries`), without a notice.

## Commands

- `retry.now { conversationId }` calls `ITurnRetryPort.retryNow`; `retry.stop { conversationId }` calls `stopRetrying`. Both go through `RetryConversationTurnUseCase`; without a retry waiting they close the cards still shown as open and answer an `error` event (`There is no retry waiting`).
- `message.send` while a retry waits records the `user_message`, then calls `retryNow` with its text and the attachments resolved by `WebConversationUploadsService`, and starts no turn: the CEO reads the message with the retry, after the orchestrator transcribes its audio.
- `turn.cancel` cancels the wait too (`CancelAgentTurnUseCase`), so the turn ends as cancelled.
