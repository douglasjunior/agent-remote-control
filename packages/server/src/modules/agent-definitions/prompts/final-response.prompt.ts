import { FINAL_RESPONSE_CLOSE, FINAL_RESPONSE_OPEN } from '../../orchestrator/constants/final-response.constant.js';


export const FINAL_RESPONSE_INSTRUCTIONS = `### Final Response
- Every turn has exactly one final response block, ${FINAL_RESPONSE_OPEN}...${FINAL_RESPONSE_CLOSE}, with the final answer as plain text without code fences. It is the last thing of the turn: text before it is progress narration, and text after it is discarded.
- Everything the caller must receive goes inside the block, including any protocol tag.
- Ending the turn delivers your answer to the caller and discards everything still running, so every subagent and background task you started must have finished, and its result be read, before the final answer. Prefer running them in the foreground.`;
