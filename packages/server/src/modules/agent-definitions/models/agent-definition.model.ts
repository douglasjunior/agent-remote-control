import type { ArtifactAccess } from '../../orchestrator/ports/agent-registry.port.js';

import type { AgentRole } from './agent-role.type.js';


export type AgentSessionMode = 'resume' | 'new';

export interface AgentDelegationContract {
  readonly project?: 'required' | 'optional';
  readonly sessionMode?: 'overridable';
  readonly readOnly?: true;
  readonly artifact?: 'required' | 'optional';
  readonly needsReviewableWork?: true;
}

export interface AgentDefinition {
  readonly role: AgentRole;
  readonly name: string;
  readonly description: string;
  readonly defaultModel?: string;
  readonly defaultSessionMode?: AgentSessionMode;
  readonly delegation: AgentDelegationContract;
  readonly artifacts: ArtifactAccess;
  /** Lists every skill, reads any of them and writes the user's skills through skill requests. */
  readonly writesSkills?: true;
  readonly turnReminder?: string;
  readonly systemPromptEveryTurn?: boolean;
  buildSystemPrompt(team: readonly AgentDefinition[]): string;
}
