import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';
import { ASKING_THE_USER_SKILL_NAME, USER_QUESTIONS_GUIDE } from '../prompts/user-questions.prompt.js';


export const ASKING_THE_USER_SKILL: AgentSkillDefinition = {
  name: ASKING_THE_USER_SKILL_NAME,
  description: 'How to ask the user for a decision while you work - the <question> grammar, making each question stand on its own, recommending an option, attachments in the answers, and answers that time out. Read it before asking the user anything.',
  roles: ['DEVELOPER', 'GIT_OPS', 'PRODUCT_OWNER', 'TECH_LEAD'],
  buildContent: () => `# Asking the User\n\n${USER_QUESTIONS_GUIDE}`,
};
