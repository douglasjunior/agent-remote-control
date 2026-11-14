import type { AgentSkillSummary } from '../models/agent-skill.model.js';


/**
 * The skills of a role, sent with its system prompt: their content is read on demand. A role that writes skills also
 * learns that it lists, reads and writes the skills of every role.
 */
export function buildSkillCatalogPrompt(skills: readonly AgentSkillSummary[], writesSkills = false): string {
  return [
    '[SKILLS]',
    'Skills hold the detailed know-how of your role. The skills listed here are kept by the server, not in any folder, so you read one only with <skill_read name="skill-name"/> inside your final response (several names separated by commas): before work a skill describes, read it in full; its content comes back in <request_results> in your next prompt. Read it again in a new session rather than relying on memory. They add to the guidance and skills a project keeps in its own files, which you still follow.',
    ...(writesSkills
      ? ['You also manage the skills of every role: <skill_list/> lists them all with the roles that read them, <skill_read> reads any of them, and <skill_write> creates or changes one. Before creating or changing a skill, read the skill below about writing skills.']
      : []),
    ...skills.map(skill => `- ${skill.name}: ${skill.description}`),
    '[/SKILLS]',
  ].join('\n');
}
