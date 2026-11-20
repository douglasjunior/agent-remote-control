import { FINAL_RESPONSE_CLOSE, FINAL_RESPONSE_OPEN } from '../../orchestrator/constants/final-response.constant.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';


/**
 * What an agent reads when it comes back to a session it already has. The instructions it received there may have been
 * compacted away, so the note carries the rules nothing else enforces and names the skill that holds them in full.
 */
export function buildReentryNote(roleName: string, rules: readonly string[]): string {
  return [
    '[RE-ENTRY]',
    `You are back in a session you started as the ${roleName}. When your role instructions are no longer in view, read them again with <skill_read name="${SKILL_NAMES.roleGuide}"/> before going on.`,
    ...rules.map(rule => `- ${rule}`),
    `- End your turn only after every subagent and background task you started has finished, with your final answer inside ${FINAL_RESPONSE_OPEN}...${FINAL_RESPONSE_CLOSE}.`,
  ].join('\n');
}
