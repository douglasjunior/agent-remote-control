import type { AgentRole } from './agent-role.type.js';


export type AgentSessionMode = 'resume' | 'new';

export interface AgentDefinition {
  readonly role: AgentRole | string;
  readonly name: string;
  readonly description: string;
  readonly defaultModel?: string;
  readonly defaultSessionMode?: AgentSessionMode;
  readonly turnReminder: string;
  buildSystemPrompt(team: readonly AgentDefinition[]): string;
}
