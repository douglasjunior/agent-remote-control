export type AgentRole = 'CEO' | 'DEVELOPER' | 'CODE_REVIEWER' | 'TECH_LEAD';

export const AGENT_ROLES: readonly AgentRole[] = [
  'CEO',
  'DEVELOPER',
  'CODE_REVIEWER',
  'TECH_LEAD',
] as const;
