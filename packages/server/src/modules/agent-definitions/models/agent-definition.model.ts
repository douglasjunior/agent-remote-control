import type { ArtifactAccess, DelegationContract } from '../../orchestrator/ports/agent-registry.port.js';

import type { AgentRole } from './agent-role.type.js';


export type AgentSessionMode = 'resume' | 'new';

export interface AgentDefinition {
  readonly role: AgentRole;
  readonly name: string;
  /** One sentence for the team list of the coordinator's prompt; `description` is the full entry of its catalog. */
  readonly summary: string;
  readonly description: string;
  readonly defaultModel?: string;
  readonly defaultSessionMode?: AgentSessionMode;
  readonly delegation: DelegationContract;
  readonly artifacts: ArtifactAccess;
  /** Lists every skill, reads any of them and writes the user's skills through skill requests. */
  readonly writesSkills?: true;
  /** What the agent reads with a prompt that reaches a session it already has. */
  readonly reentryNote?: string;
  readonly systemPromptEveryTurn?: boolean;
  buildSystemPrompt(team: readonly AgentDefinition[]): string;
}
