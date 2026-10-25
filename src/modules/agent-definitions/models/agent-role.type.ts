export const AGENT_ROLES = [
  'CEO',
  'GIT_OPS',
  'DEVELOPER',
  'CODE_REVIEWER',
  'TECH_LEAD',
  'PRODUCT_OWNER',
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];
