import { FINAL_RESPONSE_CLOSE, FINAL_RESPONSE_OPEN } from '../../agent/constants/final-response.constant.js';


export const FINAL_RESPONSE_INSTRUCTIONS = `### Final Response
- End every turn with your final answer wrapped exactly once in ${FINAL_RESPONSE_OPEN}...${FINAL_RESPONSE_CLOSE}, as plain text without code fences.
- Everything the caller must receive goes inside the block, including any protocol tag. Text outside the block is shown only as progress narration and is not delivered as your answer.`;
