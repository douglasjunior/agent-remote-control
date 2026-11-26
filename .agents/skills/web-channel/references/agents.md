# Agent configuration, usage and login

## Configuration

The web channel has no dialog state. Agent configuration is a stateless API over the orchestrator's lists:

- `agents.list`, `models.list { agentId }` and `efforts.list { agentId, modelId }` answer the requester with `agents.list`, `models.list` and `efforts.list` events; an unavailable agent answers `error`, so no CLI is probed for an unknown id.
- `profiles.get { conversationId }` answers a `profiles` event with `configured`, one entry per role, the `appliedSquad` (absent when none was applied) and `customized` (`IAgentConfigurationPort.getSquadState`). `GetConversationProfilesUseCase` reads `hasSettings`, a pure query, so reading never changes a conversation.
- `profiles.set { conversationId, roles?, agentId, modelId?, effortId? }` goes to `IAgentConfigurationPort.configureProfiles`, which validates the ids against those lists and takes the names from them (the web layer holds no rule), then broadcasts `profiles`; a rejected set answers the requester with an `error`.

## Squads

- `squads.list` answers the requester with `squads { squads }`, each squad with its role profiles as `RoleProfile`s (only the roles it sets, with whether each agent is installed), by name.
- `squads.save { id?, name, description?, isDefault, profiles }` (profiles by role, ids only) and `squads.delete { id }` go to `IAgentConfigurationPort.saveSquad`/`deleteSquad` through `WebSquadsService`, which broadcasts `squads` to every connection after a change; a refusal (`A squad needs a name`, `Another squad is named "X"`, `<Role>: Unknown model`, `Unknown squad`...) answers the requester alone with an `error` without `conversationId`.
- `squads.apply { conversationId, squadId }` (`ApplyConversationSquadUseCase`) copies the squad into the conversation and broadcasts its `profiles`; an unknown squad answers an `error` with the `conversationId`. A squad changed or deleted later turns `customized` on for the conversations that applied it; clients ask `profiles.get` again on `squads`.
- `squads.save`, `squads.delete` and `squads.apply` are logged by type.

## Usage

- `quota.get { refresh? }` answers the requester with `quota.report { reports, fetchedAt }`, the `IAgentTurnPort.getQuota()` reports (`AgentQuotaReport`: `agent`, `status` `ok`, `unsupported` or `failed`, and `quota`).
- Every query starts the agents' CLIs, so `WebAgentQuotaService` reuses a result for `QUOTA_CACHE_TTL_MS` (4 minutes), and all connections share the query in progress; `refresh: true` skips the stored result, and a failure is never stored.
- A query that throws answers `quota.failed`, not `error`, because the settings sheet takes an `error` without a `conversationId` as its own and this query runs in the background.
- `remainingFraction` has no range in the schema, since an invalid frame is dropped whole; clients clamp it.

## Login

- `auth.status { refresh? }` answers the requester with `auth.status { agents, fetchedAt }`, the `IAgentAuthPort.listAuthInfo()` entries (`AgentAuthInfo`: `agentId`, `displayName`, `status` `authenticated`, `unauthenticated` or `unknown`, and `detail`).
- Every query starts CLIs, so `WebAgentAuthService` reuses a result for `AUTH_STATUS_CACHE_TTL_MS` (2 minutes), below the client's 5-minute check, and all connections share the query in progress; `refresh: true` skips the stored result and a failure is never stored. A query that throws answers `auth.status.failed`, not `error`, for the same reason as `quota.failed`.
- `auth.login { agentId }` starts the CLI login (`IAgentAuthPort.startLogin`). Every `auth.login { agentId, event }` progress event (`url` with an optional device `code`, `prompt`, `completed`, `failed`, `cancelled`) goes to **every** open connection, so any tab shows the same link and result, and a `completed` login also broadcasts a fresh `auth.status`.
- A login that cannot start (disabled feature, no CLI login, CLI missing) answers the requester alone with a `failed` event.
- `auth.input { agentId, text }` writes a code pasted from the browser to the waiting login and answers a `failed` event when none waits; `auth.cancel { agentId }` stops the login.
- `auth.login` and `auth.cancel` are logged by type; the link, the code and `auth.input` never reach the log.
