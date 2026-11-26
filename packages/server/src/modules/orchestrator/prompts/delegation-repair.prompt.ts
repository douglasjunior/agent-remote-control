import { FINAL_RESPONSE_CLOSE, FINAL_RESPONSE_OPEN } from '../constants/final-response.constant.js';


export function buildDelegationRepairPrompt(reason: string): string {
  return [
    '[DELEGATION_ERROR]',
    'The orchestrator could not process your previous response.',
    '',
    'Reason (fix exactly this):',
    reason,
    '',
    `Answer again following the Response Protocol, with your whole response inside one ${FINAL_RESPONSE_OPEN}...${FINAL_RESPONSE_CLOSE} block:`,
    '- To delegate, write each task specification inside <delegate role="ROLE" summary="what the user reads" project="project-folder">...</delegate>.',
    '- To answer the user and end the turn, write without any <delegate> tag, adding <attachment path="/absolute/path">description</attachment> for each file to send.',
    '- To ask the user, write each question as <question rationale="why the answer matters">question text<option>choice</option></question>, without <delegate> or <attachment> tags.',
    '- Inside the block, text outside the tags is shown to the user; never mention the tags. Text outside the block is only progress narration.',
  ].join('\n');
}
