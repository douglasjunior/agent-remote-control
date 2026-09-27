export type AgentRole =
  | 'CEO'
  | 'GIT_OPS'
  | 'DEVELOPER'
  | 'CODE_REVIEWER'
  | 'TECH_LEAD';

export const AGENT_ROLES: readonly AgentRole[] = [
  'CEO',
  'GIT_OPS',
  'DEVELOPER',
  'CODE_REVIEWER',
  'TECH_LEAD',
] as const;
