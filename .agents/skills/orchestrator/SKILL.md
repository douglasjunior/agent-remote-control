---
name: orchestrator
description: >
  Channel-agnostic agent orchestration: turns, CEO delegation (<delegate>/<agent_result>),
  questions agents ask the user, ACP session resumption by role, project and task, per-conversation
  agent/model/effort settings and squads, user language, agent requests (artifacts and skills read on
  demand) and the same requests as agent tools over MCP (tool sessions, IAgentToolsPort), cancellation and
  queueing. Agents only: menus and typed input belong to each channel. Use when implementing turns,
  delegation, cancellation, session or settings persistence, agent configuration, squads, agent requests,
  agent tools or new channel interfaces.
---

# Channel-Agnostic Agent Orchestrator

> **Maintaining this skill**
>
> Update this document whenever any rule described here changes. The criterion is not
> which rule — it is the nature of the change: an orchestrator guideline or convention
> changed → update; technical refactor that preserves the described pattern → leave it alone.

The `OrchestratorModule` module lives in `packages/server/src/modules/orchestrator/` and centralizes
all turn coordination between input clients (chat channels such as Discord,
HTTP APIs or scheduled jobs) and the development agent adapters.

The orchestrator is fully decoupled from the channels' presentation technology.
It receives standardized requests, keeps the conversational state, creates its own ACP
session for each conversation, coordinates the CEO's delegation to specialist agents
and relays activity and text streams on demand.

## Structure

Each class owns one part of a turn; channels reach them only through the public ports below.

| Class | Responsibility |
|---|---|
| `ExecuteAgentTurnUseCase` | The CEO turn: one per conversation at a time, with the inbox of messages that join it (steered into the CEO's prompt running or read with its next one), its rounds and repairs, its questions, resumed work, the board check before its answer and the `TurnResult` |
| `RunDelegationUseCase` | The delegated agents: start, reach an agent already at work as the CEO chose (see "Agents Already at Work"), run its follow-ups in the same session, hold the artifact and move its status, stop, record on the session binding when its work ended, and the `<agent_result>` of each, cut to a receipt when its verdict closed the step and it runs long |
| `AnswerAgentQuestionsUseCase` | An agent's questions to the user and the answers back, with one repair for invalid or forbidden questions; an answer the timeout assumed is commented on the asker's artifact |
| `RunAgentRequestsUseCase` | Board and skill requests: `execute` runs one response's requests, `resolve` repeats until a response has none or carries them with its outcome, or with its answer when they only update or comment, and `executeOne` runs a single request for a tool call with the same checks and result |
| `RunAgentToolUseCase` | A tool call of a tool session: the request of the same name, carried out by `executeOne` for the session's requester, logged in its conversation |
| `StopArtifactWorkUseCase` | Stops the agent holding an artifact the user moved to a work-ending status |
| `CancelAgentTurnUseCase`, `RestoreOpenWorkUseCase`, `ConfigureAgentProfilesUseCase`, `RunShellCommandUseCase`, `TranscribeAudioAttachmentsUseCase`, `GetAgentQuotaUseCase` | Cancellation, open work after a restart, profiles, the shell command, audio transcription and quotas |
| `ListSquadsUseCase`, `SaveSquadUseCase`, `DeleteSquadUseCase`, `ApplySquadToConversationUseCase` | Squads: saved sets of role profiles a conversation copies in one go, and the default squad new conversations start with |
| `RetryCeoRoundUseCase` | A failed prompt of the CEO: shows the failure, waits and sends the same prompt again, like a question waits for an answer (`TurnRetryService`, `TurnRetryConfigService`) |
| `AgentRoundService` | One prompt of one agent in its session: connect, resume or create the session of its role, project and task, system prompt and `[SKILLS]` (new session, or one still `unanswered`), re-entry note and current `[SKILLS]` (resumed session), each written for the interface of the session (`interfaceOf`), language, profile, requests written outside the envelope (each once), protocol repair, the cost of each prompt (`onPrompt`); the binding of a session stays `unanswered` until the agent shows itself at work on a prompt; `recordWorkEnded` marks the binding of a session whose work on its artifact ended; a session it creates or loads gets the agent tools of its requester, and a live one hands them to the turn running now |
| `DelegationValidatorService` | Classifies a CEO response and checks each delegation against the team, the board, the workspace and the running agents |
| `DelegationStatusService` | The status flow of a delegated task: `refusal` (a status the role does not take), `start` (moves the task to the role's start status from a status the role takes, and returns the status the delegation works in, none otherwise) and `finish` (applies the status of the verdict that is the first line of the final answer, the word alone in its own case, while the task is still in that working status, and returns the verdict with whether it closed the step) |
| `DelegationLimitsConfigService` | `DELEGATION_SPEC_MAX_CHARS` (600) and `AGENT_RESULT_MAX_CHARS` (2000), `0` disabling each |
| `*ConfigService` | `QuestionTimeoutConfigService`, `TurnRetryConfigService`, `DelegationLimitsConfigService` and `ShellCommandConfigService` read their settings from `IRuntimeSettingsPort` on every call, never from `process.env`, so a value saved from the web applies to the next use |
| `SteeringSupportService` | Whether each coding agent takes text into a running prompt, recorded by `AgentRoundService` at every `connect()`, so the CEO and the validator know it before delegating |
| `TeamProfilesService`, `CeoBoardService` | The `[TEAM_PROFILES]` and `[BOARD]` blocks of the CEO prompt; `CeoBoardService.findStranded` also finds, among the tasks the turn delegated, those it would leave mid-flow |
| `ConversationRuntimeService` | Live state per conversation: the CEO port, its one `ConversationTurn` with its inbox and the turns waiting to resume work, active delegations, pending CEO notices and agent receipts; closes the tool session of every port it disposes of |
| `AgentToolSessionsService`, `AgentToolCatalogService`, `AgentToolRequestService`, `AgentToolsConfigService` | The live tool sessions and their credentials, the tools and instructions of a role, tool arguments read as requests, and `AGENT_MCP_ENABLED` |
| `AgentProtocolService`, `DelegationDetectorService`, `QuestionParserService`, `AgentRequestParserService` | Reading agent output: the final response envelope, delegations, questions and requests |
| `prompts/*.prompt.ts` | Every text the orchestrator writes into a prompt (results, answers, attachments, repairs, notices, language, skills) |

## A Turn in Short

1. The channel calls `IAgentTurnPort.executeTurn`. Audio attachments become text. A conversation runs one turn at a time: a message that finds one running joins it (see "Messages During a Turn") instead of starting another.
2. The CEO runs on its conversation port, one round at a time (`ConversationRuntimeService.runOnCeo`), with `[TEAM_PROFILES]`, `[BOARD]` (first round, and a round carrying a user message), pending notices, attachments, the messages of the inbox and the language block.
3. Its board and skill requests run first; then its response is one outcome: a delegation, questions to the user, or the answer.
4. Delegations run in parallel, each agent in its project folder and in the session of its task (of its project, for work without an artifact); the CEO gets each `<agent_result>` as it finishes and decides again. A delegation to a role already at work goes to that agent (see "Agents Already at Work").
5. The turn ends with the CEO's answer once no delegation runs, or as failed or cancelled; delegations still running are stopped, and a message still in the inbox starts the next turn. An answer that leaves tasks the turn delegated mid-flow with nobody on them and unnamed is not delivered: the CEO goes back once with `[BOARD_CHECK]` and owes a complete answer, attachments included.

Read [references/turn-execution.md](references/turn-execution.md) before changing any of these steps; it covers the directory hierarchy, the tag protocol, the CEO rounds, delegations and each agent round in detail.

### Agent Requests: Artifacts and Skills

Every CEO and delegate response goes through `RunAgentRequestsUseCase.resolve` before it is classified: `AgentRequestParserService`
reads the agent requests and the response without them, and `RunAgentRequestsUseCase` runs them in order: artifact requests on the board of the conversation
under the access of the role (`IAgentRegistryPort.getArtifactAccess`), and the skill requests through `IAgentSkillsPort`:
`<skill_read name="a,b"/>` (`read(role, name, agentInterface)`, built for the interface of the requester's session, the content returned as `<request_result request="skill_read" name="a,b">` with one `# Skill: <name>` block per skill; an unknown
name fails the request and lists the skills of the role), and, for a role that writes skills (`writesSkills`), `<skill_list/>` (`listAll`, one line per skill with whether it is built-in, its roles and description)
and `<skill_write name roles description>content</skill_write>` (`write`; the result says whether the skill was created or updated, or why it was refused). When any request of a response failed, the `<request_results>` block is followed by a note sending the agent to the grammar in its skills before writing them again. Each `<skill_read>` and `<skill_write>` also reaches the channel as a `skill` activity of the agent (`execute`'s `onSkill`, wired to `TurnRequest.onActivity`). The system prompt carries the `[SKILLS]` catalog wherever it is sent (`IAgentSkillsPort.list(role)`). A response whose rest has an outcome (a delegation or questions
for the CEO, questions for a delegate), or whose requests are all `update`, `comment` or `skill_write` that succeeded next to the text of an answer, is classified from that rest and its `<request_results>` open the agent's next prompt
(`PendingRequestResults`), so an answer that also moves its task arrives in one round. Any other one (a read, a creation, whose id the agent must read, a failed or invalid request, or nothing but requests) gets the results right away, followed by a note saying why the response was not taken as the final answer and asking for the whole final answer again, opened the way the agent's instructions say, until a response carries none (`MAX_REQUEST_ROUNDS`, 30). Each failed request is logged as `[Agent Request Failed]` with its reason. A role that creates artifacts (`create`) also writes the `overview` of what it creates, whatever its `sections`; an update stays within `sections`. A delegation with `artifact="T-1"` is validated against the board (`DelegationValidatorService`): known, of a type the
role works on, neither frozen nor closed, in a status the role takes (`DelegationStatusService.refusal`), with a pull request or a branch when the contract has `needsReviewableWork`, held by no agent of another role, in its project,
which becomes the delegation's folder, and with a specification no longer than `DELEGATION_SPEC_MAX_CHARS` unless it redirects the agent of that role already working on that artifact. `RunDelegationUseCase` assigns it before creating the port, sets the role's start status (`start`), prefixes the first prompt with
`[DELEGATED_ARTIFACT]`, applies the verdict of the final answer (`finish`) while it still holds the artifact and the task is in the status it worked in, releases it in `finally` with how the work ended, and records on the session binding when its work ended, once the agent answered a prompt of the delegation; an instruction reaches a running delegation without a new one only
on its same artifact. The block holds the full content (`ArtifactPromptFormatterService.detail`) for a session new to the task, a resumed one whose binding records no end of work, and any feature; a resumed session on a task whose binding records one gets the facts and only the sections changed and comments added since
(`changesSince`, see [references/turn-execution.md](references/turn-execution.md)).

### Agents Already at Work

A conversation runs one agent per role, so a delegation to a role with an active delegation goes to that agent. Its
same work is the same project and artifact (`null` alike), and never work restored after a restart, which keeps its
own record. `on_busy` (`wait` or `interrupt`, `DelegationResult.onBusy`) says what happens to the current work:

- **Same work, no `on_busy`** (the validator allows it only when `SteeringSupportService` says the agent takes
  steering): the instruction goes to the running prompt in an `[INSTRUCTION_UPDATE]` block
  (`prompts/instruction-update.prompt.ts`: the new text, what changed on its task since it was last sent, and the
  reminder that a tool call moved to the background must end before the answer). When it is not `injected`, it is kept
  (`DelegationControl.keep`) and the run's next prompt carries it; a run whose last prompt left one kept sends one more
  prompt instead of ending.
- **`interrupt` on the same work**: the instruction is kept and, in the same tick, the running prompt is cancelled
  (`IAgentPort.cancel`), or the agent's questions are discarded when it waits for the user; the cancellation is caught
  and the next prompt, in the same session, carries the instruction.
- **`wait` on the same work**: a follow-up (`DelegationControl.follow`), run in the same session as a `[FOLLOW_UP]`
  prompt once the current run has its result, with its own events and its own `<agent_result>` for the turn that sent it.
- **Other work**: `wait` waits for the agent's delegation to end (`DelegationControl.ended`) and starts after it;
  `interrupt` ends that work as replaced and waits until it released its artifact before starting the new one.
- A run that is finishing takes no more instructions, so a steering or interruption that comes too late becomes a
  follow-up, and a delegation that is closing takes no more follow-ups, so they wait for it to end instead.
- The validator rejects a delegation without `on_busy` to a busy role on other work, or on the same work of an agent
  whose steering is unsupported or not known yet, with a repair that explains both choices (`prompts/busy-role.prompt.ts`).
- Steering, keeping and interrupting record the instruction on the delegation (its `summary` and its updates, kept on
  the open work), emit a `steered` delegation event, and leave a receipt; so does queueing a follow-up or a delegation
  that waits. A receipt is an `<agent_result status="steered|queued|interrupted">` (`prompts/agent-receipt.prompt.ts`)
  held by `ConversationRuntimeService` until the CEO's next prompt, a round or a steered user message, so it never costs
  a round of its own; a round whose delegations all joined other runs leaves the CEO waiting on those runs, and with
  nothing left to wait for its next prompt carries just the receipts.
- One decision per role at a time: `RunDelegationUseCase` decides what an arriving delegation does, and starts one,
  under a lock per conversation and role, so two never start side by side.

### Messages During a Turn

A conversation runs one turn at a time (`ConversationRuntimeService.admit`); a message that finds one running joins its
inbox (`ConversationTurn`) and its `executeTurn` resolves once it reached the CEO (`status: 'steered'`), was cancelled, or
starts the next turn:

- **CEO in the middle of a prompt**: with the CEO's agent taking steering (`acceptsSteering`), the inbox is steered into
  the running prompt in one `sendSteeringPrompt` (`[TEAM_PROFILES]`, `[BOARD]`, receipts, a `[USER_MESSAGE]` block per
  message from `prompts/user-message.prompt.ts`, the language block), one steering at a time; the turn does not end while a steering is under way, so a
  message it hands back is not lost. Otherwise, or when it does not land, the message waits (`onDelivery('queued')`) and every next CEO prompt of the turn (a round, request results,
  answers, a repair) carries the inbox as `[USER_MESSAGE]` blocks (`delivered`).
- **CEO idle, waiting for its delegates**: the message wakes it (`RunningDelegations.nextResults(turn.arrival())`) and
  is read at once in a round of the same turn, with the results finished so far; a reply then is an interim message.
- **Turn ending**: a message still waiting when the turn ends starts the next turn as its prompt, with the other waiting
  messages read in its first prompt (`delivered`); a turn resuming interrupted work (`resumeWork`, `deliverAnswers`)
  waits for the running one too (`acquire`).
- **Part of the turn's input**: a prompt that carried a user message, read or steered, validates with
  `userInitiated=true`; a prompt that failed is retried with the messages steered into it; the root's open work keeps
  every message that joined in its `updates`, so a resume after a restart presents them; and a turn that failed or was
  cancelled tells the next one, in its `[PREVIOUS_TURN]` notice, the messages it had read.
- Pending questions and retries keep their own handling in each channel (answers, `retryNow`).

### Agent Tools over MCP

An agent whose CLI takes a Streamable HTTP MCP server (`IAgentPort.supportsHttpMcp`) also gets the eight requests as
tools it calls during its turn, with the same names: `artifact_list`, `artifact_read`, `artifact_create`,
`artifact_update`, `artifact_comment`, `skill_read`, `skill_list`, `skill_write`. The tags keep working for every
agent, the ones with tools included: a resumed session may have been taught only the tags, and every response still
goes through `RunAgentRequestsUseCase.resolve`.

- **Tool sessions**: when `AgentRoundService` creates or loads a session, `AgentToolSessionsService.open` closes the
  port's previous tool session, opens one for the round's `requester` (the same `AgentRequester` its tags act for,
  delegation and artifact included) and returns the server to attach (`arc`, the URL and the `authorization: Bearer`
  header with a credential of 32 random bytes); the failed load and the session created in its place share it. None is
  opened for an agent without `supportsHttpMcp`, with `AGENT_MCP_ENABLED=false`, or before the inbound adapter called
  `IAgentToolsPort.serveAt`. A round on a live session hands the tool session to its own turn (`update`), so skill
  activity reaches the channel of the turn running now.
- **Closing**: the class that disposes of a port closes its tool session first: `RunDelegationUseCase` in the
  delegation's `finally` and when it replaces a running delegation, `ConversationRuntimeService` when the CEO agent
  changes, when the conversation expires and on shutdown. A closed or unknown credential is refused everywhere.
- **One implementation**: a tool call becomes the `AgentRequest` its tag makes (`AgentToolRequestService`; unknown
  arguments ignored, a list read from an array or a comma-separated string, unreadable input an `invalid` request)
  and runs through `RunAgentRequestsUseCase.executeOne`, so the access checks and messages are the tag's. The result
  is the request's body, flagged as an error when it failed. A tool the role was not given still runs and is refused
  by those checks; a name outside the eight is `unknown_tool`.
- **Tools and instructions** (`AgentToolCatalogService`): each role gets the tools its `ArtifactAccess` allows, with
  schemas built from the catalog and that access, and its skill catalog in the `instructions`, whose first line stands
  alone. The tools are fast: nothing that waits for a person is a tool, so questions, `<delegate>`, `<attachment>` and
  the final response stay tags.
- **Interface**: a session is on the tools interface exactly while its port holds an open tool session
  (`AgentToolSessionsService.interfaceOf`), on the tags interface otherwise: no capability, `AGENT_MCP_ENABLED=false`
  or nothing serving the tools. `AgentRoundService` writes the system prompt, the re-entry note and the `[SKILLS]`
  catalog for it, and a skill is built for it whichever way it is read: a tool session's requester carries
  `agentInterface: 'tools'`, and the CEO turn and each delegation pass the interface of their port with the requests of
  a response (`AgentRequester.agentInterface`, `tags` when absent). Every message the server writes to an agent without
  knowing its interface (a validator or status refusal, `[BOARD_CHECK]`, `[DELEGATION_ERROR]`) names no board or skill
  tag; the notes after `<request_results>` go only to the tags path.

The tool list per role, the schemas and the exact instructions are in
[references/agent-tools.md](references/agent-tools.md). Read it before changing a tool, a schema or the instructions.

### User Language

Agents talk to each other in English; only the text that reaches the user follows `Preferences.language`.
`AgentRoundService` appends a `[USER_LANGUAGE]` block (`prompts/user-language.prompt.ts`) at the end of every prompt,
including CEO steering and steering of an active delegation:

- **CEO with a stored language**: `buildCeoLanguagePrompt(language)`: everything shown to the user in that language, delegation specifications in English.
- **CEO without a stored language**: `buildLanguageDetectionPrompt()` asks it to answer in the language of the user's message and add `<user_language>language name in English</user_language>`.
- **Delegated agents**: `buildAgentLanguagePrompt(language)`, defaulting to `DEFAULT_USER_LANGUAGE` (`English`), because their final response and questions reach the user unchanged. It also says that protocol tags and the verdict word that opens a final answer are written exactly as the instructions show them, in English, since the server matches them literally.

`extractUserLanguage()` (`utils/user-language.util.ts`) removes every `<user_language>` tag outside Markdown code from
each CEO response before it is classified. While no language is stored, the first CEO response settles it: the tag's
language, or English without a valid tag. A stored language changes only through a language change request or the
settings page of the web channel.
`normalizeUserLanguage()` parses with `userLanguageSchema` of the protocol, which the settings page checks with too: it
collapses whitespace and rejects empty names, names over 64 characters and names with `<`, `>`, `[`, `]` or backticks,
since the language goes into every prompt.

`UserLanguageService` reads (`get()`, `English` when none is stored; `getStored()`, `undefined` then), changes (`set(input)`, normalized; `undefined` for an invalid name) and forgets (`reset()`, so the next CEO response settles it again) the stored language. Asking the user for the language is a channel dialog.

### Turn Cancellation (`CancelAgentTurnUseCase`)

The `execute(conversationId: string): Promise<boolean>` method empties the conversation's question queue
(`cancel`), stops a running shell command, closes the open work, triggers `ConversationRuntimeService.cancel(conversationId)`, which also cancels the messages
waiting in the turn's inbox, and returns whether there was a turn in progress or a pending question, including in a turn that has not yet saved the session. The resulting
`PromptCancelledError`, coming from the agent or from the rejected wait, interrupts the delegation
loop, and the conversation returns to the default state.

## Public Ports

`OrchestratorModule` exports only five ports (interface plus Symbol in `ports/`), each implemented by a small service. Channels and other inbound modules depend on them and never on the services and use cases behind them; their specs use the stubs in `testing/` (`StubAgentTurnPort`, `StubAgentConfigurationPort`, `StubUserQuestionPort`, `StubTurnRetryPort`, `StubAgentToolsPort`), which implement the interfaces.

- **Attachments are the channel's to fetch and the orchestrator's to interpret.** A channel obtains the files in its own way (Discord downloads them from its CDN, the web channel reads its uploads) and hands them over only as `TurnRequest.attachments` (`TurnAttachment`: `name`, absolute `path`, `contentType`, `size`) plus the text as typed; it never rewrites the prompt for them. Audio becomes text in the turn (see `TranscribeAudioAttachmentsUseCase`); other files are listed in an `[ATTACHMENTS]` block for the agent to inspect.
- **`IAgentTurnPort`** (`AgentTurnService`): `executeTurn(request)`, `listInterruptedWork(conversationId)`, `resumeWork(workId, request)`, `deliverAnswers(answers, request)`, `cancelTurn(conversationId)`, `isShellCommandEnabled()`, `runShellCommand(conversationId, command)` and `getQuota()`. `getQuota` queries every available agent (`listAvailableAgents()`) in parallel with `Promise.allSettled`, each with a 15000 ms timeout, on a port that is never connected and is disconnected afterwards. Each `AgentQuotaReport` is `{ agent: { id, name }; status: 'ok' | 'unsupported' | 'failed'; quota?: AgentQuota }`: `ok` carries the quota, `unsupported` means the agent does not expose one and `failed` covers an error or a timeout, so a hung or failing agent never blocks the others. With no available agent the list is empty.
- **`IAgentConfigurationPort`** (`AgentConfigurationService`): `listAgents()`, `getDefaultAgent()`, `currentAgent(conversationId)`, `listModels(agentId)`, `listEfforts(agentId, modelId)`, `listRoles()`, `listProfiles(conversationId)`, `hasSettings(conversationId)` (a pure query: own settings, a default squad or inheritable settings exist), `ensureSettings(conversationId)`, `saveProfiles(conversationId, roles | undefined, profile)` (a profile the caller already resolved), `configureProfiles(input)` (`ConfigureAgentProfilesUseCase`: checks agent, roles, model and effort against the lists, takes the names from them, saves, and returns `{ ok: true }` or `{ ok: false, error }` with `Unknown agent`, `Unknown role`, `Unknown model`, `An effort needs a model` or `Unknown effort`), the squads (`listSquads()`, `saveSquad(input)`, `deleteSquad(squadId)`, `applySquad(conversationId, squadId)`, `getSquadState(conversationId)`, see [references/agent-configuration.md](references/agent-configuration.md)), `getLanguage()`, `getStoredLanguage()`, `setLanguage(input)` and `resetLanguage()`.
- **`IUserQuestionPort`** (`UserQuestionService`): `hasPendingQuestions(conversationId)`, `currentQuestion(conversationId)` and `answerQuestion(conversationId, answer)` (structured, see the question queue).

- **`IAgentToolsPort`** (`AgentToolsService`): `serveAt(endpoint)` (the inbound adapter says how an agent CLI reaches the tools with a credential: `connection(credential)` returns the `url` and `headers`, or `undefined` while it cannot), `isOpen(credential)`, `describe(credential)` (`AgentToolCatalog`: `instructions` and `tools`, each `name`, `description`, `inputSchema`; `undefined` for a credential that is not open) and `call(credential, name, args)` (`AgentToolCallResult`: `done` with `text` and `isError`, `unknown_tool` or `closed`).
- **`ITurnRetryPort`** (`TurnRetryService`): `hasPendingRetry(conversationId)`, `retryNow(conversationId, message?)` (the user's text and attachments, which the CEO reads with the retry once the orchestrator has transcribed the audio) and `stopRetrying(conversationId)`, each returning whether a retry was waiting. The channel shows the wait through `TurnRequest.onRetry` (see "A Failed Prompt Waits to Be Retried").

## A Failed Prompt Waits to Be Retried

A prompt to the CEO that throws, or a response that stays `invalid` after its repair, does not end the turn: `RetryCeoRoundUseCase` shows the failure and waits, the way a question waits, inside the same `runOnCeo` and `ActiveTurn`, then sends the failed prompt again. The unit of retry is the prompt, never the round: every prompt `runCeoTurn` sends (the round prompt, the answers of the user, the results of agent requests, a repair) is wrapped by `execute`, so a retry repeats exactly that text, plus the user messages the inbox gave it or that were steered into it, and the answers and results already exchanged stay delivered. A response that stays invalid is handled by `pause`, which waits and returns the `RetryNote`; the repair prompt is then sent again with the note and the repair budget restarts. The wait is `TurnRetryService.wait`: a `Countdown` (`models/countdown.model.ts`, shared with the question queue) whose end retries, ended earlier by `retryNow` (the user's message goes into the retry prompt, after `ExecuteAgentTurnUseCase.prepareRetryMessage` transcribes its audio like any message, so `onTranscription` fires), by `stopRetrying` (the failure stands: the error is thrown, or the invalid response is the result, so the turn fails as it would have) or by `cancel` (`CancelAgentTurnUseCase` rejects it with `PromptCancelledError`, so the turn is cancelled). A cancellation is never retried.

- **Schedule**: `nextRetryDelay` (`utils/retry-delay.util.ts`) doubles the wait from `TURN_RETRY_BASE_DELAY_MS` (15 s) up to `TURN_RETRY_MAX_DELAY_MS` (2 h), and cuts the last wait to what is left of `TURN_RETRY_MAX_TOTAL_MS` (5 h) counted from the first failure, ending the retries when what is left is shorter than the base wait; `0` in any of them disables the retries. Each `RetryBudget` (`models/retry-budget.model.ts`) holds the attempts and the first failure of one stretch of failures: `execute` opens one per prompt, so a prompt that succeeds ends the failure and the next one starts again from the base, and `runCeoTurn` keeps one for the pauses of invalid responses.
- **Events**: `TurnRequest.onRetry` gets `scheduled` (`RetryPrompt`: `roleName`, `errorMessage`, `attempt`, `timeout`) and `ended` (`elapsed`, `requested`, `stopped` or `cancelled`). A channel renders them and sends `retryNow` and `stopRetrying`; it runs no turn.
- **Retry prompt**: `buildTurnRetryPrompt` (`prompts/turn-retry.prompt.ts`) starts with `[RETRY]`, tells the CEO the error and to check what it already did, carries what the user wrote, and ends with the prompt that failed whole, since the failed attempt may not have delivered it. The `[TEAM_PROFILES]` and `[BOARD]` blocks and the notices are part of the round prompt, so a retry carries them again.
- Delegated agents are not retried: their failure reaches the CEO as a failed `<agent_result>`, and the CEO decides.

## Mandatory Prescriptive Rules

- **No coupling to Discord or network channels**: the orchestrator handles only generic identifiers (`conversationId`, `userId`), without importing discord.js, HTTP frameworks or third-party drivers.
- **Ports and Symbols**: every dependency external to the use cases must use Symbol injection (`@Inject(ISessionStorePort)`).
- **No barrel exports**: never create `index.ts` in `models/`, `ports/`, `adapters/`, `services/` or `use-cases/`.
- **Cleanup of reactive resources**: every callback registered in `onActivity` must be disconnected in a `finally` block.
- **One ACP session per conversation, role, agent, project and task**: obtain `IAgentPort` instances exclusively through `IAgentPortFactory`, always with the turn's `agentId`. Each conversation's CEO agent lives in `ConversationRuntimeService`, and each delegation uses a disposable instance that resumes the role's ACP session for its task, or for its project when it has no artifact.
- **Session holds only data**: `SessionContext` stores only serializable data. Live agents, queue and active turn stay in `ConversationRuntimeService`, because the store is persisted to disk.
- **One turn per conversation**: every turn is admitted by `ConversationRuntimeService.admit` (or `acquire`, to resume work) and ended with `endTurn`, and interactions with the CEO go through `runOnCeo(conversationKey, turn, agentId, work)`, so `prompt()` is never called twice at once on the CEO port; a message that arrives meanwhile joins the running turn.
- **Cancellable delegation**: every running agent must be registered with `turn.activate(agentPort)`, and `turn.throwIfCancelled()` must precede `connect` and `prompt`.
- **Round limit**: keep `MAX_DELEGATION_ROUNDS` to prevent infinite loops between the CEO and delegated agents.
- **Do not leak exceptions from execute()**: `ExecuteAgentTurnUseCase.execute()` must return `TurnResult` with `status: 'failed'` or `status: 'cancelled'`, never throw uncontrolled errors to the presentation layer.

## References

- [references/models-and-ports.md](references/models-and-ports.md): the models (`SessionContext`, `TurnRequest`, `ActiveTurn`, `ActiveDelegation`, `ValidatedDelegation`, `TurnResult`, `AgentSettings`), the internal ports, persistence in `DATA_DIR` and the supporting services. Read when changing a model, a port contract or a store.
- [references/turn-execution.md](references/turn-execution.md): how a turn runs step by step. Read before changing turns, delegations or agent rounds.
- [references/questions-and-restart.md](references/questions-and-restart.md): the question grammar, the per-conversation queue, timeouts and work across a restart. Read before changing questions, answers or open work.
- [references/agent-tools.md](references/agent-tools.md): the tools of each role, their schemas and the instructions of a tool session. Read before changing a tool, a schema or the instructions.
- [references/agent-configuration.md](references/agent-configuration.md): per-conversation agent, model and effort profiles, squads and the default squad. Read before changing agent settings or squads.
