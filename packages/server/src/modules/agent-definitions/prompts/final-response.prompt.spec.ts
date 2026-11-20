import { describe, expect, it } from '@rstest/core';

import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';


describe('final-response.prompt', () => {
  it('should ask for a single final response envelope', () => {
    expect(FINAL_RESPONSE_INSTRUCTIONS).toContain('wrapped exactly once in <final_response>...</final_response>');
  });

  it('should deliver protocol tags inside the block and treat text outside it as progress narration', () => {
    expect(FINAL_RESPONSE_INSTRUCTIONS).toContain('Everything the caller must receive goes inside the block, including any protocol tag');
    expect(FINAL_RESPONSE_INSTRUCTIONS).toContain('not delivered as your answer');
  });

  it('should require background work to finish before the final answer', () => {
    expect(FINAL_RESPONSE_INSTRUCTIONS).toContain('every subagent and background task you started must have finished');
  });
});
