# Agent, Model and Effort Configuration

The per-conversation profiles of each role, the squads that set them in one go, and the configuration port the channels use. Read before changing agent settings, profiles or the configuration API.


The choice is per conversation and persisted; the orchestrator offers the lists and stores the result, and each channel decides how the user picks. `AgentCapabilitiesService` builds the lists as `AgentOption`s:
`listAgentOptions()` from `IAgentPortFactory.listAvailableAgents()` (only agents whose CLI is in the `PATH`), `isAgentAvailable(agentId)` from the factory, and `listModelOptions(agentId)` /
`listEffortOptions(agentId, modelId)` on a disposable port of the agent (`create(agentId)` →
`connect()` → read → `disconnect()` in `finally`), isolated from the conversation's port. Without options,
they return an empty list. `resolveAgent(settings)` returns the CEO profile's agent or the factory default.

`AgentProfilesService` keeps the profiles of a conversation:

- `current(conversationId)`: the conversation's settings, else what it would start with (the default squad over
  `loadMostRecent()`, or `loadMostRecent()` alone without a default squad), else `null`;
- `ensure(conversationId)`: `'configured'` when the conversation has settings; otherwise, within one `update` of the
  store, `'squad'` after applying the default squad over the most recent settings, `'inherited'` after copying the most
  recent settings (with their `appliedSquad`) when there is no default squad, both with a renewed `updatedAt`, and
  `'missing'` when there is neither;
- `list(conversationId)`: one `AgentRoleProfile` per role from `IAgentRegistryPort.listRoles()`, with the profile of `current` and `agentAvailable`. A profile whose agent is not installed stays untouched and execution keeps using it, so its turns fail at `connect()` with the agent's CLI-not-found error;
- `listRoles()` and `save(conversationId, roles | undefined, profile)`: applies the profile to the roles (every role when `undefined`) over what `current` gives, inside one `update` of the store, keeps `appliedSquad`, stamps `updatedAt` with the current time and returns the settings;
- `applySquad(conversationId, squad)`: copies every profile of the squad over what `current` gives, in one `update`,
  leaving the roles the squad does not set as they are, and records `appliedSquad { id, name }`;
- `squadState(conversationId)` (`ConversationSquadState`): no `appliedSquad` and `customized: false` without one;
  otherwise the squad named as it is saved now, `customized` when any role it sets differs in agent, model or effort
  from the conversation, or with the recorded name and `customized: true` when the squad was deleted;
- `listSquadProfiles(squad)`: the roles the squad sets, in team order, as `AgentRoleProfile`s.

`AgentProfileResolverService.resolve(choice, lists?)` checks `{ agentId, modelId?, effortId? }` against the installed
agents and the agent's lists and takes the names from them (`Unknown agent`, `Unknown model`, `An effort needs a model`,
`Unknown effort`); `lists` keeps each list asked for, so the profiles of one squad probe each agent once.

## Squads

A squad (`Squad`: `id`, `name`, `description?`, `isDefault`, `profiles` by role, `createdAt`, `updatedAt`) is a saved
set of role profiles a conversation copies in one go; each role stays editable afterwards.

- `ISquadStorePort` (`SqliteSquadStoreAdapter`, tables `squad` and `squad_profile`): `list()` by name, `get(id)`,
  `findDefault()`, `save(draft)` and `delete(id)`. `save` runs in one `SqliteTransactionService.run`: it refuses an
  unknown `id` (`not-found`) and a name another squad has in any letter case (`name-taken`), clears the other default
  when the draft is the default, gives a new squad a UUID and keeps the creation time of an existing one.
- `ListSquadsUseCase` returns `SquadView`s (profiles as `AgentRoleProfile`s). `SaveSquadUseCase` trims the name
  (`A squad needs a name`) and the description (blank is none), needs one profile at least
  (`A squad needs a profile for at least one role`), refuses an unknown role (`Unknown role`), resolves every profile
  with the resolver, prefixing its error with the role name (`Developer: Unknown model`), and maps the store's refusals
  to `Another squad is named "<name>"` and `Unknown squad`. `DeleteSquadUseCase` returns whether the squad existed.
  `ApplySquadToConversationUseCase` answers `Unknown squad` or applies it, roles whose agent is not installed included.
- A conversation keeps the copy: editing or deleting the squad later changes none of its profiles, only `customized`.
- The default squad is what a conversation without settings starts with: `ensure` applies it over the most recent
  settings, so the roles it leaves out keep the inherited profiles. Without a default squad a new conversation
  inherits the most recent settings.

`TranscribeAudioAttachmentsUseCase` `({ prompt, attachments? })` → `AudioTranscriptionResult { prompt, attachments, transcripts, warnings }`: with the port disabled or without audio it returns the input untouched. Each audio attachment (`audio/*` or a known audio extension) is transcribed in order; a non-empty transcript replaces the file, which is deleted through `IFileSystemPort`. The resulting prompt is the typed text followed by the transcripts (a single transcript as is, several labeled `[Audio: <name>]`). Empty transcripts and failures never fail the turn: the audio stays in `attachments` and a user-facing warning is returned. It is internal to the orchestrator and no channel calls it: `ExecuteAgentTurnUseCase` runs it on every turn before any agent sees the message, so a message reaches the CEO (or steers it) with the transcript in the prompt and without the audio file, whichever channel sent it. The same happens to the attachments of each answer to an agent's question, when the answer is consumed. `TurnRequest.onTranscription({ transcripts, warnings })` tells the channel what was transcribed and what could not be, before the agents run. A message that is left with attachments and no text gets `ATTACHMENTS_ONLY_PROMPT` as its prompt.


Switching agents does not interrupt turns in progress: the conversation's next turn switches the
CEO port and the following delegates are born on the new agent.
