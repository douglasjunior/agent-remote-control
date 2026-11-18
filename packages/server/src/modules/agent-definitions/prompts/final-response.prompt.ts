import { FINAL_RESPONSE_CLOSE, FINAL_RESPONSE_OPEN } from '../../orchestrator/constants/final-response.constant.js';


const UNFINISHED_WORK_RULE = 'Ending the turn delivers your answer to the caller and discards everything still running, so every subagent and background task you started must have finished, and its result be read, before the final answer. Prefer running them in the foreground.';

export const FINAL_RESPONSE_REMINDER = `- Wrap your final answer in ${FINAL_RESPONSE_OPEN}...${FINAL_RESPONSE_CLOSE}, and only after every subagent and background task you started has finished and been read.`;

export const FINAL_RESPONSE_INSTRUCTIONS = `### Final Response
- End every turn with your final answer wrapped exactly once in ${FINAL_RESPONSE_OPEN}...${FINAL_RESPONSE_CLOSE}, as plain text without code fences.
- Everything the caller must receive goes inside the block, including any protocol tag. Text outside the block is shown only as progress narration and is not delivered as your answer.
- ${UNFINISHED_WORK_RULE}`;
