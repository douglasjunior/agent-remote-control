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

/** A turn has exactly one final response block, so a response with several is answered again; its blocks are never joined. */
export function buildFinalResponseCountRepairPrompt(blocks: number): string {
  return [
    '[PROTOCOL_ERROR]',
    `Your previous response had ${blocks} ${FINAL_RESPONSE_OPEN} blocks, but a turn has exactly one, so nothing was done with it.`,
    `Answer again with the whole answer, every protocol tag included, in a single ${FINAL_RESPONSE_OPEN}...${FINAL_RESPONSE_CLOSE} block at the end of the turn.`,
  ].join('\n');
}
