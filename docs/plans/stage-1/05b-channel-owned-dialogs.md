# 05b — Orchestrator for agents only; dialogs belong to the channels

**Model:** Sonnet 5.5 · **Effort:** high · **Depends on:** 05

## Goal

The orchestrator deals with agents: running turns, delegation, the questions agents ask, per-conversation agent settings, quota and shell. It does not know about menus, option numbers or what the user types next. Every conversation dialog (the `/agent`, `/model` and `/profiles` menus, the language request, reading "2" as an option) lives in the channel that needs it. Discord keeps its numbered menus; the web channel gets a stateless API with structured commands.

## Read first

`AGENTS.md`, the skills `orchestrator`, `discord-bot`, `web-channel`, `clean-architecture-nestjs` and `tests-best-practices`, and in `modules/orchestrator`: `services/orchestrator.service.ts` (replaced by three ports), `use-cases/{resolve-conversation-input,start-agent-config-selection,submit-agent-config-selection,cancel-agent-config-selection}.use-case.ts`, `services/{agent-capabilities,agent-profile-list,language-change-request,user-question-queue}.service.ts`, `adapters/in-memory-agent-config-selection-store.adapter.ts` and the models `agent-config-selection`, `agent-config-outcome`, `user-question`.

## Orchestrator after this plan

Keeps: turns, delegation, cancellation, quota, shell, audio transcription, the settings and preferences stores, and the question queue.

- **Neutral option model:** `AgentOption { id, name, description? }` replaces `SelectionOption`. It has no `index`: numbering is a menu concern. `AgentCapabilitiesService` returns it for agents, models and efforts.
- **`AgentProfilesService`** (settings per conversation, no menu state): `current(conversationId)` (the conversation's settings, else the most recent ones), `list(conversationId)` (every role with its display name and profile), `save(conversationId, roles | undefined, profile)` (`undefined` = every role; returns the settings and the profile) and `ensure(conversationId)` returning `'configured' | 'inherited' | 'missing'` (`inherited` copies the most recent settings into the conversation).
- **`UserLanguageService`:** `get()` and `set(raw)` (normalizes and persists; `null` when invalid).
- **`UserQuestionQueueService.submit`** takes structured input: `{ kind: 'option', optionIndex }` or `{ kind: 'text', text }`, plus optional attachments. It never reads a number from text. `current(conversationId)` already exposes the open question so a channel can decide how to read what the user typed.
- **Three ports are the only public surface** of `OrchestratorModule`, each with an interface and an injection Symbol in `ports/`, implemented by a small service. The `OrchestratorService` facade and the exports of internal services are removed; channels never import `AgentCapabilitiesService`, `AgentProfilesService`, `UserLanguageService`, `UserQuestionQueueService` or a use case.
  - `IAgentTurnPort` (`AgentTurnService`): `executeTurn`, `cancelTurn`, `transcribeAudio`, `isShellCommandEnabled`, `runShellCommand`, `getQuota`.
  - `IAgentConfigurationPort` (`AgentConfigurationService`): `listAgents`, `getDefaultAgent`, `currentAgent`, `listModels`, `listEfforts`, `listRoles`, `listProfiles`, `hasSettings` (a pure query), `ensureSettings`, `saveProfiles` (a profile the caller already resolved), `configureProfiles` (checks the ids against the lists, takes the names from them and saves; returns `{ ok }` or an error), `getLanguage` and `setLanguage`.
  - `IUserQuestionPort` (`UserQuestionService`): `hasPendingQuestions`, `currentQuestion`, `answerQuestion`.
- **Fakes implement the ports** (`orchestrator/testing/stub-agent-turn.port.ts`, `stub-agent-configuration.port.ts`, `stub-user-question.port.ts`), so a contract change breaks the build; no spec casts to a class.

Removed from the orchestrator: `IAgentConfigSelectionStorePort` and its adapter, `AgentConfigSelection` and `SelectionOption` models, the outcome and resolution models, `LanguageChangeRequestService`, `AgentProfileListService`, and the use cases `resolve-conversation-input`, `start-agent-config-selection`, `submit-agent-config-selection` and `cancel-agent-config-selection`.

## Discord after this plan

The removed code moves to `modules/discord` and keeps its behavior: the selection store (port, in-memory adapter), the menu models, the profile list service, the language request service and the four use cases. A new `DiscordConversationService` exposes what the handlers called on the orchestrator facade before: `resolveInput`, `startAgentSelection`, `startConfigSelection`, `startProfilesSelection`, `cancelConfigSelection`, `hasActiveConfigSelection`, `requestLanguageChange`, `hasPendingLanguageChange` and `cancelLanguageChange`.

`resolveInput` is where Discord decides what a typed message means: with a question open, a whole number becomes `{ kind: 'option' }` when the question has options and anything else becomes `{ kind: 'text' }`. Menu options get their `index` when the menu is built.

The Discord behavior does not change: its specs move with the code and keep passing, and the e2e suite for the bot stays green.

## Web after this plan

No menu state. The protocol changes:

- **Removed:** the `selection` entry, and the commands `config.open`, `config.cancel`, `selection.choose` and `selection.back`.
- **Client commands:** `agents.list`; `models.list { agentId }`; `efforts.list { agentId, modelId }`; `profiles.get { conversationId }`; `profiles.set { conversationId, roles?, agentId, modelId?, effortId? }` (`roles` omitted = every role, at least one when present). `question.answer` stays.
- **Server events:** `agents.list { agents }`; `models.list { agentId, models }`; `efforts.list { agentId, modelId, efforts }`; `profiles { conversationId, configured, profiles }` (`configured` is `hasSettings`: the conversation has settings or can inherit the most recent ones) where each profile is `{ role, roleName, agent?, model?, effort? }` with `{ id, name }` values and `agent.available`. `profiles.set` answers by broadcasting `profiles` for the conversation, so every open tab updates.
- **Validation in `profiles.set`:** done by the orchestrator's `configureProfiles`: the agent must be one of `agents.list`, the model one of `models.list` for that agent, and the effort (which requires a model) one of `efforts.list`; otherwise an `error` event. Names come from the lists, never from the client.
- **First message:** `message.send` calls `ensureSettings` first. When it returns `missing` and agents are available, the server publishes a warning `notice` ("Choose an agent, model and effort for this conversation before sending messages.") and does not run or record the message. When no agent is installed the turn runs with the default agent, as in Discord. The client reads `configured` from `profiles` and keeps the composer disabled until it is true.
- `message.send` no longer resolves menu or question state: it executes a turn, which the orchestrator steers or queues when one is running. Questions are answered only with `question.answer`.

## Steps

1. **Orchestrator:** add `AgentOption`, `AgentProfilesService`, `UserLanguageService`, `ConfigureAgentProfilesUseCase`, the structured `submit` and the three ports with their services; adapt `AgentCapabilitiesService`. Specs for each new piece.
2. **Discord:** move the code and specs with `git mv`, depend on the ports only, add `DiscordConversationService`, switch the handlers to it, add the option-number reading to `resolveInput`. The moved specs use the port fakes; `pnpm test:e2e` stays green.
3. **Delete** the removed orchestrator code once nothing imports it.
4. **Protocol:** replace the commands, events and entry as listed; update the specs.
5. **Web module:** stateless use cases over the ports (`ListAgentOptions`, `GetConversationProfiles`, `SetConversationProfiles`, `AnswerConversationQuestion`); `SendConversationMessageUseCase` calls the turn and configuration ports directly; drop `resolveInput` and the `selection` mapping. Profile validation lives in the orchestrator (`configureProfiles`), and `profiles.get` reads `hasSettings` without changing anything.
6. **Skills:** update `orchestrator` (agents only), `discord-bot` (owns the menus) and `web-channel` (stateless API).
7. **Manual run** against a real agent: `profiles.get` shows `configured: false`, `message.send` is refused with the notice, `agents.list` → `models.list` → `efforts.list` → `profiles.set`, then `message.send` runs the turn.

## Tests

- Orchestrator: specs for `AgentProfilesService`, `UserLanguageService`, the structured `submit` and the new facade methods.
- Discord: the moved specs, plus the option-number reading in `resolveInput`.
- Web: use cases with the stub orchestrator and the fake store; handler routing, validation errors and the first-message refusal.
- e2e: web `agents.list` and `profiles.get` round trip.

## Acceptance

`pnpm ts`, `pnpm lint`, `pnpm test` (100% line coverage target kept) and `pnpm test:e2e` pass. `grep -rn "selection\|option number" packages/server/src/modules/orchestrator` finds no menu or numbered-input code.

## Commits

- `refactor(orchestrator): move menu and language dialogs to the discord module`
- `feat(web): configure agents through structured commands`
