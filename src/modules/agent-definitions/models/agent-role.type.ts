export const AGENT_ROLES = [
  'CEO',
  'GIT_OPS',
  'DEVELOPER',
  'CODE_REVIEWER',
  'TECH_LEAD',
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];
