# Questions

## Answering

- Questions are answered with `question.answer`: `answer` is `{ kind: 'option', optionIndex }` or `{ kind: 'text', text, attachments? }`, where text may be empty with attachments.
- The answer goes to `IUserQuestionPort.answerQuestion` with the attachments resolved by `WebConversationUploadsService`, the same check `message.send` uses; a file that is not an upload of the conversation records an `error` notice and answers nothing.
- Without an open question the command closes the questions still shown as open and answers an `error` event.
- A valid answer is echoed as a `user_message` (the text typed, or the text of the chosen option, with its attachments). The confirmation, the next question or a retry follow as entries.

## Closing

- A `question` entry stays open (`closed: false`) until the server closes it by upserting the same entry id with `closed: true`, which keeps it in place in the history.
- `WebConversationEventsService.closeOpenQuestions` does it, and it knows the open questions because it sees every entry it publishes.
- Two events close a question: any `question.answer` the orchestrator accepts (`next`, `invalid` or `answered`), before the entries that follow it are published, and the conversation reaching `idle`, because nothing can answer the question any more (cancellation included). Closing a question does not discard the draft.
- A conversation becoming `idle` keeps its questions open while the orchestrator still has one pending.

## Restart and resumption

Web turns are `resumable`, so a server restart keeps their questions and work.

- `conversation.history` settles the questions first (`GetConversationHistoryUseCase`): the open entry of the question the queue restored is tracked again, a restored question with no open entry is published, and any other open entry has nothing waiting on it and is closed by `settleOrphanedQuestions`.
- `closeUnanswerableQuestions` closes every open one when the orchestrator refuses an answer.
- Both closings add one `warning` `notice`, id `question-abandoned:<questionId>`, telling the user to send a message to continue; a refused answer is not delivered.
- Answering the last question of a restored request (`restoredWork` in the submission) runs `ResumeConversationWorkUseCase.deliverAnswers`.
- `work.resume { conversationId, workId }` runs its `execute`, for an agent a restart stopped mid-round; an agent that asked never offers it, and a request for work that is not listed does nothing.
- `conversation.history` carries the list in `interrupted`, and `conversation.interrupted { conversationId, interrupted }` broadcasts it when it changes.
