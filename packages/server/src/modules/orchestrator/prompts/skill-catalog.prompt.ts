import type { AgentSkillSummary } from '../models/agent-skill.model.js';


/** The skills of a role, sent with its system prompt: their content is read on demand. */
export function buildSkillCatalogPrompt(skills: readonly AgentSkillSummary[]): string {
  return [
    '[SKILLS]',
    'Skills hold the detailed know-how of your role. Before work a skill describes, read it in full with <skill_read name="skill-name"/> inside your final response (several names separated by commas); its content comes back in <request_results> in your next prompt. Read it again in a new session rather than relying on memory.',
    ...skills.map(skill => `- ${skill.name}: ${skill.description}`),
    '[/SKILLS]',
  ].join('\n');
}
