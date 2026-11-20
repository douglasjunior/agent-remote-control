import { AGENT_TOOLS_SERVER_NAME } from '../../orchestrator/constants/agent-tools.constant.js';
import { FINAL_RESPONSE_CLOSE, FINAL_RESPONSE_OPEN } from '../../orchestrator/constants/final-response.constant.js';
import type { AgentInterface } from '../../orchestrator/models/agent-interface.model.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';


/**
 * The session may have started on the tags interface, before the tools existed: naming the tools here is what moves the
 * agent onto them.
 */
const WHERE_THE_INSTRUCTIONS_ARE: Readonly<Record<AgentInterface, string>> = {
  tags: `When your role instructions are no longer in view, read them again with <skill_read name="${SKILL_NAMES.roleGuide}"/> before going on.`,
  tools: `The board and your skills are reached through the tools of the \`${AGENT_TOOLS_SERVER_NAME}\` MCP server, which you call during your turn and which answer at once: \`artifact_read\` reads a task and \`skill_read\` a skill. When your role instructions are no longer in view, read them again with \`skill_read\` and the \`${SKILL_NAMES.roleGuide}\` skill before going on.`,
};

/**
 * What an agent reads when it comes back to a session it already has. The instructions it received there may have been
 * compacted away, so the note carries the rules nothing else enforces and names the skill that holds them in full.
 */
export function buildReentryNote(roleName: string, rules: readonly string[], agentInterface: AgentInterface): string {
  return [
    '[RE-ENTRY]',
    `You are back in a session you started as the ${roleName}. ${WHERE_THE_INSTRUCTIONS_ARE[agentInterface]}`,
    ...rules.map(rule => `- ${rule}`),
    `- End your turn only after every subagent and background task you started has finished, with your final answer inside ${FINAL_RESPONSE_OPEN}...${FINAL_RESPONSE_CLOSE}.`,
  ].join('\n');
}
