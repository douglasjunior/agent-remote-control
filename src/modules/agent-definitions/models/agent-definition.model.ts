import type { AgentRole } from './agent-role.type.js';

export interface AgentDefinition {
  role: AgentRole | string;
  name: string;
  description: string;
  systemPrompt: string;
  defaultModel?: string;
}
