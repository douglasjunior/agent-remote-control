import type { WorkspaceFile } from '../../orchestrator/models/workspace-file.model.js';

import type { AgentRole } from './agent-role.type.js';


export type AgentSessionMode = 'resume' | 'new';

export interface AgentDelegationContract {
  readonly project?: 'required' | 'optional';
  readonly sessionMode?: 'overridable';
}

export interface AgentDefinition {
  readonly role: AgentRole;
  readonly name: string;
  readonly description: string;
  readonly defaultModel?: string;
  readonly defaultSessionMode?: AgentSessionMode;
  readonly delegation: AgentDelegationContract;
  readonly turnReminder?: string;
  readonly systemPromptEveryTurn?: boolean;
  buildSystemPrompt(team: readonly AgentDefinition[]): string;
  buildWorkspaceFiles?(team: readonly AgentDefinition[], workspaceDir: string): readonly WorkspaceFile[];
}
