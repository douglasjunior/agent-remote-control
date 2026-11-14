---
name: orchestrator
description: >
  Channel-agnostic agent orchestration: turns, CEO delegation (<delegate>/<agent_result>),
  questions agents ask the user, ACP session resumption by role and project, per-conversation
  agent/model/effort settings, user language, agent requests (artifacts and skills read on demand),
  cancellation and queueing. Agents only: menus and typed input belong to each channel. Use when
  implementing turns, delegation, cancellation, session or settings persistence, agent configuration,
  agent requests or new channel interfaces.
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
| `ExecuteAgentTurnUseCase` | The CEO turn: steering a running CEO, its rounds and repairs, its questions, resumed work and the `TurnResult` |
| `RunDelegationUseCase` | The delegated agents: start, steer or replace, hold the artifact, stop, and the `<agent_result>` of each |
| `AnswerAgentQuestionsUseCase` | An agent's questions to the user and the answers back, with one repair for invalid or forbidden questions |
| `RunAgentRequestsUseCase` | Board and skill requests: `execute` runs one response's requests, `resolve` repeats until a response has none |
| `StopArtifactWorkUseCase` | Stops the agent holding an artifact the user moved to a work-ending status |
| `CancelAgentTurnUseCase`, `RestoreOpenWorkUseCase`, `ConfigureAgentProfilesUseCase`, `RunShellCommandUseCase`, `TranscribeAudioAttachmentsUseCase`, `GetAgentQuotaUseCase` | Cancellation, open work after a restart, profiles, the shell command, audio transcription and quotas |
| `AgentRoundService` | One prompt of one agent in its session: connect, resume or create the session, system prompt and `[SKILLS]`, reminder, language, profile, protocol repair |
| `DelegationValidatorService` | Classifies a CEO response and checks each delegation against the team, the board, the workspace and the running agents |
| `TeamProfilesService` | The `[TEAM_PROFILES]` block of the CEO prompt |
| `ConversationRuntimeService` | Live state per conversation: the CEO port and its queue, active turns and delegations, pending CEO notices |
| `AgentProtocolService`, `DelegationDetectorService`, `QuestionParserService`, `AgentRequestParserService` | Reading agent output: the final response envelope, delegations, questions and requests |
| `prompts/*.prompt.ts` | Every text the orchestrator writes into a prompt (results, answers, attachments, repairs, notices, language, skills) |

## A Turn in Short

1. The channel calls `IAgentTurnPort.executeTurn`. Audio attachments become text, and a message that reaches a CEO already working steers it instead of starting a turn.
2. The CEO runs on its conversation port, one round at a time (`ConversationRuntimeService.runOnCeo`), with `[TEAM_PROFILES]`, pending notices, attachments, its reminder and the language block.
3. Its board and skill requests run first; then its response is one outcome: a delegation, questions to the user, or the answer.
4. Delegations run in parallel, each agent in its own session and project folder; the CEO gets each `<agent_result>` as it finishes and decides again.
5. The turn ends with the CEO's answer once no delegation runs, or as failed, cancelled or steered; delegations still running are stopped.

Read [references/turn-execution.md](references/turn-execution.md) before changing any of these steps; it covers the directory hierarchy, the tag protocol, the CEO rounds, delegations and each agent round in detail.

### Agent Requests: Artifacts and Skills

Every CEO and delegate response goes through `RunAgentRequestsUseCase.resolve` before it is classified: `AgentRequestParserService`
reads the agent requests and the response without them, and `RunAgentRequestsUseCase` runs them in order: artifact requests on the board of the conversation
under the access of the role (`IAgentRegistryPort.getArtifactAccess`), and the skill requests through `IAgentSkillsPort`:
`<skill_read name="a,b"/>` (`read(role, name)`, the content returned as `<request_result request="skill_read" name="a,b">` with one `# Skill: <name>` block per skill; an unknown
name fails the request and lists the skills of the role), and, for a role that writes skills (`writesSkills`), `<skill_list/>` (`listAll`, one line per skill with whether it is built-in, its roles and description)
and `<skill_write name roles description>content</skill_write>` (`write`; the result says whether the skill was created or updated, or why it was refused). When any request of a response failed, the `<request_results>` block is followed by a note sending the agent to the grammar in its skills before writing them again. Each `<skill_read>` and `<skill_write>` also reaches the channel as a `skill` activity of the agent (`execute`'s `onSkill`, wired to `TurnRequest.onActivity`). The system prompt carries the `[SKILLS]` catalog wherever it is sent (`IAgentSkillsPort.list(role)`). A response whose rest has an outcome (a delegation or questions
for the CEO, questions for a delegate) is classified from that rest and its `<request_results>` open the agent's next prompt
(`PendingRequestResults`); any other one gets the results right away, until a response carries none (`MAX_REQUEST_ROUNDS`, 30). A delegation with `artifact="T-1"` is validated against the board (`DelegationValidatorService`): known, of a type the
role works on, neither frozen nor closed, with a pull request or a branch when the contract has `needsReviewableWork`, held by no agent of another role, and in its project,
which becomes the delegation's folder. `RunDelegationUseCase` assigns it before creating the port, prefixes the first prompt with
`[DELEGATED_ARTIFACT]` (its full content) and releases it in `finally` with how the work ended; a running delegation is steered only
for the same artifact.

### User Language

Agents talk to each other in English; only the text that reaches the user follows `Preferences.language`.
`AgentRoundService` appends a `[USER_LANGUAGE]` block (`prompts/user-language.prompt.ts`) to every prompt, after
the turn reminder, including CEO steering and steering of an active delegation:

- **CEO with a stored language**: `buildCeoLanguagePrompt(language)`: everything shown to the user in that language, delegation specifications in English.
- **CEO without a stored language**: `buildLanguageDetectionPrompt()` asks it to answer in the language of the user's message and add `<user_language>language name in English</user_language>`.
- **Delegated agents**: `buildAgentLanguagePrompt(language)`, defaulting to `DEFAULT_USER_LANGUAGE` (`English`), because their final response and questions reach the user unchanged.

`extractUserLanguage()` (`utils/user-language.util.ts`) removes every `<user_language>` tag outside Markdown code from
each CEO response before it is classified. While no language is stored, the first CEO response settles it: the tag's
language, or English without a valid tag. A stored language changes only through a language change request.
`normalizeUserLanguage()` collapses whitespace and rejects empty names, names over 64 characters and names with
`<`, `>`, `[`, `]` or backticks, since the language goes into every prompt.

`UserLanguageService` reads (`get()`, `English` when none is stored) and changes (`set(input)`, normalized; `undefined` for an invalid name) the stored language. Asking the user for the language is a channel dialog.

### Turn Cancellation (`CancelAgentTurnUseCase`)

The `execute(conversationId: string): Promise<boolean>` method empties the conversation's question queue
(`cancel`), stops a running shell command, closes the open work, triggers `ConversationRuntimeService.cancel(conversationId)` and returns whether there was a turn in
progress or a pending question, including in a turn that has not yet saved the session. The resulting
`PromptCancelledError`, coming from the agent or from the rejected wait, interrupts the delegation
loop, and the conversation returns to the default state.

## Public Ports

`OrchestratorModule` exports only three ports (interface plus Symbol in `ports/`), each implemented by a small service. Channels depend on them and never on the services and use cases behind them; their specs use the stubs in `testing/` (`StubAgentTurnPort`, `StubAgentConfigurationPort`, `StubUserQuestionPort`), which implement the interfaces.

- **Attachments are the channel's to fetch and the orchestrator's to interpret.** A channel obtains the files in its own way (Discord downloads them from its CDN, the web channel reads its uploads) and hands them over only as `TurnRequest.attachments` (`TurnAttachment`: `name`, absolute `path`, `contentType`, `size`) plus the text as typed; it never rewrites the prompt for them. Audio becomes text in the turn (see `TranscribeAudioAttachmentsUseCase`); other files are listed in an `[ATTACHMENTS]` block for the agent to inspect.
- **`IAgentTurnPort`** (`AgentTurnService`): `executeTurn(request)`, `listInterruptedWork(conversationId)`, `resumeWork(workId, request)`, `deliverAnswers(answers, request)`, `cancelTurn(conversationId)`, `isShellCommandEnabled()`, `runShellCommand(conversationId, command)` and `getQuota()`. `getQuota` queries every available agent (`listAvailableAgents()`) in parallel with `Promise.allSettled`, each with a 15000 ms timeout, on a port that is never connected and is disconnected afterwards. Each `AgentQuotaReport` is `{ agent: { id, name }; status: 'ok' | 'unsupported' | 'failed'; quota?: AgentQuota }`: `ok` carries the quota, `unsupported` means the agent does not expose one and `failed` covers an error or a timeout, so a hung or failing agent never blocks the others. With no available agent the list is empty.
- **`IAgentConfigurationPort`** (`AgentConfigurationService`): `listAgents()`, `getDefaultAgent()`, `currentAgent(conversationId)`, `listModels(agentId)`, `listEfforts(agentId, modelId)`, `listRoles()`, `listProfiles(conversationId)`, `hasSettings(conversationId)` (a pure query: own or inheritable settings exist), `ensureSettings(conversationId)`, `saveProfiles(conversationId, roles | undefined, profile)` (a profile the caller already resolved), `configureProfiles(input)` (`ConfigureAgentProfilesUseCase`: checks agent, roles, model and effort against the lists, takes the names from them, saves, and returns `{ ok: true }` or `{ ok: false, error }` with `Unknown agent`, `Unknown role`, `Unknown model`, `An effort needs a model` or `Unknown effort`), `getLanguage()` and `setLanguage(input)`.
- **`IUserQuestionPort`** (`UserQuestionService`): `hasPendingQuestions(conversationId)`, `currentQuestion(conversationId)` and `answerQuestion(conversationId, answer)` (structured, see the question queue).

## Mandatory Prescriptive Rules

- **No coupling to Discord or network channels**: the orchestrator handles only generic identifiers (`conversationId`, `userId`), without importing discord.js, HTTP frameworks or third-party drivers.
- **Ports and Symbols**: every dependency external to the use cases must use Symbol injection (`@Inject(ISessionStorePort)`).
- **No barrel exports**: never create `index.ts` in `models/`, `ports/`, `adapters/`, `services/` or `use-cases/`.
- **Cleanup of reactive resources**: every callback registered in `onActivity` must be disconnected in a `finally` block.
- **One ACP session per conversation, role, agent and project**: obtain `IAgentPort` instances exclusively through `IAgentPortFactory`, always with the turn's `agentId`. Each conversation's CEO agent lives in `ConversationRuntimeService`, and each delegation uses a disposable instance that resumes the role's ACP session in that project.
- **Session holds only data**: `SessionContext` stores only serializable data. Live agents, queue and active turn stay in `ConversationRuntimeService`, because the store is persisted to disk.
- **Concurrency control and CEO mutual exclusion**: every turn registers its lifecycle in `ConversationRuntimeService.beginTurn(conversationKey)`, and interactions with the CEO go through `ConversationRuntimeService.runOnCeo(conversationKey, work)`. The CEO is released while delegates run in the background, keeping strict queuing of simultaneous calls on the same CEO port to avoid parallel calls to `prompt()`.
- **Cancellable delegation**: every running agent must be registered with `turn.activate(agentPort)`, and `turn.throwIfCancelled()` must precede `connect` and `prompt`.
- **Round limit**: keep `MAX_DELEGATION_ROUNDS` to prevent infinite loops between the CEO and delegated agents.
- **Do not leak exceptions from execute()**: `ExecuteAgentTurnUseCase.execute()` must return `TurnResult` with `status: 'failed'` or `status: 'cancelled'`, never throw uncontrolled errors to the presentation layer.

## References

- [references/models-and-ports.md](references/models-and-ports.md): the models (`SessionContext`, `TurnRequest`, `ActiveTurn`, `ActiveDelegation`, `ValidatedDelegation`, `TurnResult`, `AgentSettings`), the internal ports, persistence in `DATA_DIR` and the supporting services. Read when changing a model, a port contract or a store.
- [references/turn-execution.md](references/turn-execution.md): how a turn runs step by step. Read before changing turns, delegations or agent rounds.
- [references/questions-and-restart.md](references/questions-and-restart.md): the question grammar, the per-conversation queue, timeouts and work across a restart. Read before changing questions, answers or open work.
- [references/agent-configuration.md](references/agent-configuration.md): per-conversation agent, model and effort profiles. Read before changing agent settings.
