export const AGENT_ROLES = [
  'CEO',
  'GIT_OPS',
  'DEVELOPER',
  'CODE_REVIEWER',
  'TECH_LEAD',
  'PRODUCT_OWNER',
  'UX_DESIGNER',
  'QA',
  'IT_SUPPORT',
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];
