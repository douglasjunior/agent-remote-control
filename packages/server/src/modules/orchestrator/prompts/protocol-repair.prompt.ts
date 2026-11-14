import { FINAL_RESPONSE_CLOSE, FINAL_RESPONSE_OPEN } from '../constants/final-response.constant.js';


/** Text outside the final response block is narration, so the tags written there were dropped. */
export function buildProtocolRepairPrompt(tags: readonly string[]): string {
  const names = tags.map(tag => `<${tag}>`).join(', ');
  return [
    '[PROTOCOL_ERROR]',
    `Your previous response wrote ${names} outside the ${FINAL_RESPONSE_OPEN} block, where text is only progress narration, so nothing was done with it.`,
    `Answer again with every protocol tag, and the text that goes with it, inside a single ${FINAL_RESPONSE_OPEN}...${FINAL_RESPONSE_CLOSE} block.`,
  ].join('\n');
}
