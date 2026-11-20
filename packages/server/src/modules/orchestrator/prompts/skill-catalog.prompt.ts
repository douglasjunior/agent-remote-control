import { AGENT_TOOLS_SERVER_NAME } from '../constants/agent-tools.constant.js';
import type { AgentInterface } from '../models/agent-interface.model.js';
import type { AgentSkillSummary } from '../models/agent-skill.model.js';


const HOW_TO_READ: Readonly<Record<AgentInterface, string>> = {
  tags: 'you read one only with <skill_read name="skill-name"/> inside your final response (several names separated by commas): before work a skill describes, read it in full; its content comes back in <request_results> in your next prompt.',
  tools: `you read one only with the \`skill_read\` tool of the \`${AGENT_TOOLS_SERVER_NAME}\` MCP server, which returns its content at once (several names in one call): before work a skill describes, read it in full.`,
};

const MANAGING: Readonly<Record<AgentInterface, string>> = {
  tags: '<skill_list/> lists them all with the roles that read them, <skill_read> reads any of them, and <skill_write> creates or changes one',
  tools: '`skill_list` lists them all with the roles that read them, `skill_read` reads any of them, and `skill_write` creates or changes one',
};

/**
 * The skills of a role, sent with its system prompt and again with the prompt that reaches a resumed session: their
 * content is read on demand, the way the interface of the session reads it. A role that writes skills also learns that
 * it lists, reads and writes the skills of every role.
 */
export function buildSkillCatalogPrompt(skills: readonly AgentSkillSummary[], agentInterface: AgentInterface, writesSkills = false): string {
  return [
    '[SKILLS]',
    `Skills hold the detailed know-how of your role. The skills listed here are kept by the server, not in any folder, so ${HOW_TO_READ[agentInterface]} Read it again in a new session rather than relying on memory. They add to the guidance and skills a project keeps in its own files, which you still follow.`,
    ...(writesSkills
      ? [`You also manage the skills of every role: ${MANAGING[agentInterface]}. Before creating or changing a skill, read the skill below about writing skills.`]
      : []),
    ...skills.map(skill => `- ${skill.name}: ${skill.description}`),
    '[/SKILLS]',
  ].join('\n');
}
