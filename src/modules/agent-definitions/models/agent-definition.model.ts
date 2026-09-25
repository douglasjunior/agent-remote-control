import type { AgentRole } from './agent-role.type.js';


export interface AgentDefinition {
  readonly role: AgentRole | string;
  readonly name: string;
  readonly description: string;
  readonly defaultModel?: string;
  buildSystemPrompt(team: readonly AgentDefinition[]): string;
}
