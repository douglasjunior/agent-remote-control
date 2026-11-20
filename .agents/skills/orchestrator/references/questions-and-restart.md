# Questions to the User and Work Across a Restart

The question grammar, the queue that serializes questions per conversation, timeouts, and how open work survives a restart. Read before changing questions, answers, timeouts or the open-work store.

## Questions to the User

Any agent, including the CEO, asks the user directly when it needs a decision from them
to proceed, and the answer does not go through the CEO. The grammar goes inside `<final_response>`:

```text
My understanding is: ... (free text, shown before the first question)

<question rationale="why the answer matters">Question text
<option>Path A</option>
<option>Path B</option>
</question>
<question>Open question, without options</question>
```

- Every channel shows the asker with its project, the free text (`message`) before the first question, the
  question and its `rationale` as "Why it matters". The prompts require that text to carry the context (task,
  findings, why the agent is blocked) and the rationale to state the impact of the answer, because the user may be
  following several agents at once.
- **`QuestionParserService`** (`services/question-parser.service.ts`) returns `none`, `questions`
  (`message` and `UserQuestion[]` with `text`, `rationale?`, `options` and `recommendedIndex?`, the 1-based option
  written as `<option recommended>`) or `invalid`: `<option>` outside
  `<question>`, a tag without closing or without opening, an unknown attribute (`<question>` accepts only
  `rationale`; `<option>` only the bare flag `recommended`, on at most one option of a question), a question without text or an empty option. Tags inside Markdown code
  (a block fenced by triple backticks or a span between backticks) are quoted markup, like an HTML
  `<option>`, and stay in the text.
- **`UserQuestionQueueService`** (`services/user-question-queue.service.ts`) keeps in memory a
  queue of requests per conversation, in the order the agents asked, and exposes one question at a time.
  The queue lives in memory because the asking agent waits alive inside the turn; for a `resumable` turn the
  questions and answers are also kept on disk (see "Work Across a Restart"). Operations:
  - `ask(conversationKey, asker, message, questions, listener)`: queues and resolves with
    `AnsweredQuestion[]` when the user answers all of them. `listener` (`QuestionListener`) has `asked`, which shows
    the first question when the request reaches the front of the queue on its own (empty queue or front request
    discarded), `timedOut`, and `answersChanged`, present only on requests whose answers are kept on disk;
  - `submit(conversationKey, answer)`: `answer` is structured, `{ kind: 'option', optionIndex }` (1-based, for a
    question with options) or `{ kind: 'text', text }`, plus optional `attachments`; the queue never reads a number
    from text, so the channel decides what a typed message means. An option outside the range, or empty text
    without attachments, returns `invalid` and repeats the question; text is a free answer (`kind="other"`); attachments
    accompany the answer and also answer on their own. Outcomes: `next` (next question of the request), `answered`
    (resolves the agent's wait and carries the question of the next request, if any) and `invalid`; with no
    pending question, `undefined`;
  - `restore(conversationKey, workId, asker, questions, onAnswer)`: queues a request a restart left unanswered, with
    the answers already given. It has no countdown. Nothing waits on it: its `answered` submission carries `restoredWork` (`workId` and
    `answers`), and the channel hands it to `IAgentTurnPort.deliverAnswers`;
  - **Timeout**: the question at the front has a countdown of `QUESTION_TIMEOUT_MS` (`QuestionTimeoutConfigService`,
    default 300000 ms, `0` disables it), restarted for each question of a request and for the request that reaches
    the front. When it ends, the question is answered with its recommended option, or with nothing when it has none
    (`AnsweredQuestion.timedOut: true`, and no `optionNumber` or text when nothing was assumed), the request moves on
    like after any answer and `listener.timedOut` receives a `QuestionTimedOut` (`asker`, `answered`, `timeoutMs`, and
    the `next` prompt). Answering, `cancel` and `discard` stop the countdown. Once the request is answered,
    `AnswerAgentQuestionsUseCase.ask` comments on the artifact the asker holds (`QuestionAsker.artifactId`, set by
    `askerFor` for a delegation with an artifact), as `{ kind: 'system' }`, each assumed answer:
    `The user did not answer in time, so the recommended answer was assumed:` and a `- "<question>": <option>` line
    each. Nothing assumed, or an asker without an artifact (the CEO), writes nothing;
  - `current`, `hasPending` and `isWaiting(conversationKey, role, projectName)`;
  - `cancel(conversationKey)`: empties the queue and rejects all waits with `PromptCancelledError`;
  - `discard(conversationKey, role, projectName)`: removes the request of an agent that is being
    replaced, rejecting its wait.
- `QuestionPrompt` (`models/user-question.model.ts`) is what the channel shows: `asker` (`role`,
  `roleName`, `projectName`, `artifactId?`), `question`, `number`, `total`, `message?` (only on the first question),
  `waitingAskers` and `timeout?` (`expiresAt` in epoch milliseconds and `durationMs`; absent when the timeout is disabled).
- **Answers to the agent**: a block that repeats the text of each question, to withstand context
  compaction while the user answers, with one `<attachment>` per attached file (downloaded by the
  channel into a temporary directory):

  ```text
  <user_answers>
  <answer question="Question text" option="2">Path B</answer>
  <answer question="Another question" kind="other">free text
  <attachment path="/tmp/.../screen.png" name="screen.png" type="image/png"/></answer>
  </user_answers>
  ```

  An answer the user did not give in time carries `status="timed_out"`: with `option="N"` for the recommended
  option assumed, and without `option` or text when the question had none. A single `<note>` closes the block,
  telling the agent that the user was absent, that the assumed answers are provisional and that it decides how to
  proceed where nothing was assumed.

- **Locked state**: while the conversation has pending questions the agent is waiting, and a channel that offers a
  free-form input treats the next message as the answer (`hasPendingQuestions`, `currentQuestion`, `answerQuestion`). `/cancel` unlocks the conversation (see below).
  through steering. `/cancel` unlocks the conversation (see below).

## Work Across a Restart

A turn with `TurnRequest.resumable` (the web channel sets it; Discord does not) keeps its work on disk through
`OpenWorkService` over `IOpenWorkStorePort` (`JsonOpenWorkStoreAdapter`, `DATA_DIR/open-work.json`). Each change
writes, through `update(change)`, the records the conversation holds in memory at that moment over the other conversations
as they are on disk; a failed write is logged, and the next change of the conversation writes its records again.
Each delegation and each CEO loop has an `OpenWork` record (`models/open-work.model.ts`): role, project, `artifactId?`, `summary`,
`taskSpec`, `cwd`, `round`, `root` (the CEO) and `questions` with the answers so far. The last answer of a request is
never written. A resumed record keeps its questions until the prompt with the answers is sent: a restart before that asks
the last question again, and from then on the agent has the answers and counts as working. The record is closed when that work
ends, however it ends, and `CancelAgentTurnUseCase` closes every record of the conversation.

- **Shutdown** freezes the service in `onModuleDestroy`, before the agents are disconnected, so the turns dying during a
  graceful restart do not erase their records.
- **Boot**: `RestoreOpenWorkUseCase` loads the records as interrupted and puts unanswered questions back in the queue.
- **An agent that asked** was not interrupted: it was already waiting. `IAgentTurnPort.deliverAnswers` claims the record
  (`claimAsked`) and the agent receives `<user_answers>` like any other answer. Only when its session cannot be resumed, the
  answers are preceded by `buildLostSessionTaskPrompt`, since a new session does not know the task, and, for a delegation
  with an artifact, by the full `[DELEGATED_ARTIFACT]` block.
- **An agent that stopped mid-round** has no question to set it going, so the user continues it: `IAgentTurnPort.resumeWork`
  claims the record (`claimStopped`) and the agent receives `buildResumedWorkPrompt`, after the full `[DELEGATED_ARTIFACT]`
  block when its task's session cannot be resumed. `listInterruptedWork`
  (`OpenWorkService.continuable`) lists these records only. A root is listed only when no delegate stopped with it, because
  the delegates' results start its next round.
- **Either way** a delegate keeps its `delegationId` and its `artifactId`, runs on its stored ACP session (`session="resume"`, the session of its task when it has one), and its result goes
  to a new CEO round like any other; a root record runs on the CEO.
- **Replaced work**: a new turn discards interrupted roots that did not ask, and delegating a role again discards
  what a restart left stopped for that role, its questions included.
