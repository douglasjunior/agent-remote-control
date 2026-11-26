import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


/** The instructions of the reader's role, for a session whose history no longer holds them. */
export const ROLE_GUIDE_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.roleGuide,
  description: 'The full instructions of your role, as you received them when your session started. Read it when they are no longer in view, such as after a long session was compacted.',
  roles: ['GIT_OPS', 'PRODUCT_OWNER', 'UX_DESIGNER', 'TECH_LEAD', 'DEVELOPER', 'CODE_REVIEWER', 'QA', 'IT_SUPPORT'],
  buildContent: ({ rolePrompt }) => rolePrompt,
};
