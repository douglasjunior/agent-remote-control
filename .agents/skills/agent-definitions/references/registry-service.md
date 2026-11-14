# Registry Service (`AgentRegistryService`)

`AgentRegistryService` implements `IAgentRegistryPort` (`packages/server/src/modules/orchestrator/ports/agent-registry.port.ts`)
and registers `INITIAL_AGENT_DEFINITIONS` (`constants/initial-agents.constant.ts`) in its constructor. Roles resolve
case-insensitively.

| Method | Returns | Unknown role |
|---|---|---|
| `getSystemPrompt(agentRole)` | `buildSystemPrompt` called with all other registered definitions | a generic prompt |
| `getDefaultModel(agentRole)` | the preferred model of the role | `undefined` |
| `getDisplayName(agentRole)` | the definition's `name` | the role itself |
| `getDefaultSessionMode(agentRole)` | `'resume' \| 'new'`, `'resume'` when not configured | `'resume'` |
| `getDelegationContract(agentRole)` | the definition's `delegation` | `{}` |
| `getTurnReminder(agentRole)` | `turnReminder`, an empty string for a definition without one (always a string) | a default fallback text |
| `isSystemPromptEveryTurn(agentRole)` | whether the role receives the system prompt with every user message | `false` |
| `getArtifactAccess(agentRole)` | the role's `ArtifactAccess` | read-only access to tasks |
| `getTeam(agentRole)` | every definition but the role's own, the team its prompt and skills are built with | all of them |
| `hasRole(agentRole)` | whether the role is registered | `false` |
| `listRoles()` | the role of every registered definition, in registration order | — |
| `getDefinition(roleOrId)` | the full `AgentDefinition` | `undefined` |
| `getAllDefinitions()` | every registered definition | — |
| `registerDefinition(definition)` | adds or overrides a definition at runtime; a registered agent appears in the "Your Team" section of the CEO's prompt | — |
