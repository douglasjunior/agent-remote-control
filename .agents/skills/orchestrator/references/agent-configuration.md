# Agent, Model and Effort Configuration

The per-conversation profiles of each role and the configuration port the channels use. Read before changing agent settings, profiles or the configuration API.


The choice is per conversation and persisted; the orchestrator offers the lists and stores the result, and each channel decides how the user picks. `AgentCapabilitiesService` builds the lists as `AgentOption`s:
`listAgentOptions()` from `IAgentPortFactory.listAvailableAgents()` (only agents whose CLI is in the `PATH`), `isAgentAvailable(agentId)` from the factory, and `listModelOptions(agentId)` /
`listEffortOptions(agentId, modelId)` on a disposable port of the agent (`create(agentId)` →
`connect()` → read → `disconnect()` in `finally`), isolated from the conversation's port. Without options,
they return an empty list. `resolveAgent(settings)` returns the CEO profile's agent or the factory default.

`AgentProfilesService` keeps the profiles of a conversation:

- `current(conversationId)`: the conversation's settings, else `loadMostRecent()`, else `null`;
- `ensure(conversationId)`: `'configured'` when the conversation has settings, `'inherited'` after copying the most recent settings into it (renewed `updatedAt`) within one `update` of the store, `'missing'` when nothing was ever saved;
- `list(conversationId)`: one `AgentRoleProfile` per role from `IAgentRegistryPort.listRoles()`, with the profile of `current` and `agentAvailable`. A profile whose agent is not installed stays untouched and execution keeps using it, so its turns fail at `connect()` with the agent's CLI-not-found error;
- `listRoles()` and `save(conversationId, roles | undefined, profile)`: applies the profile to the roles (every role when `undefined`) over the stored settings, the conversation's own else the most recent, inside one `update` of the store, stamps `updatedAt` with the current time and returns the settings.

`TranscribeAudioAttachmentsUseCase` `({ prompt, attachments? })` → `AudioTranscriptionResult { prompt, attachments, transcripts, warnings }`: with the port disabled or without audio it returns the input untouched. Each audio attachment (`audio/*` or a known audio extension) is transcribed in order; a non-empty transcript replaces the file, which is deleted through `IFileSystemPort`. The resulting prompt is the typed text followed by the transcripts (a single transcript as is, several labeled `[Audio: <name>]`). Empty transcripts and failures never fail the turn: the audio stays in `attachments` and a user-facing warning is returned. It is internal to the orchestrator and no channel calls it: `ExecuteAgentTurnUseCase` runs it on every turn before any agent sees the message, so a message reaches the CEO (or steers it) with the transcript in the prompt and without the audio file, whichever channel sent it. The same happens to the attachments of each answer to an agent's question, when the answer is consumed. `TurnRequest.onTranscription({ transcripts, warnings })` tells the channel what was transcribed and what could not be, before the agents run. A message that is left with attachments and no text gets `ATTACHMENTS_ONLY_PROMPT` as its prompt.


Switching agents does not interrupt turns in progress: the conversation's next turn switches the
CEO port and the following delegates are born on the new agent.
