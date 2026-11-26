import { describe, expect, it } from '@rstest/core';

import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';


describe('final-response.prompt', () => {
  it('should ask for exactly one final response block, last in the turn', () => {
    expect(FINAL_RESPONSE_INSTRUCTIONS).toContain('exactly one final response block, <final_response>...</final_response>');
    expect(FINAL_RESPONSE_INSTRUCTIONS).toContain('It is the last thing of the turn');
  });

  it('should treat text before the block as narration and discard text after it', () => {
    expect(FINAL_RESPONSE_INSTRUCTIONS).toContain('text before it is progress narration, and text after it is discarded');
  });

  it('should deliver protocol tags inside the block', () => {
    expect(FINAL_RESPONSE_INSTRUCTIONS).toContain('Everything the caller must receive goes inside the block, including any protocol tag');
  });

  it('should require background work to finish before the final answer', () => {
    expect(FINAL_RESPONSE_INSTRUCTIONS).toContain('every subagent and background task you started must have finished');
  });
});
