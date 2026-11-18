import { describe, expect, it } from '@rstest/core';

import { FINAL_RESPONSE_INSTRUCTIONS, FINAL_RESPONSE_REMINDER } from './final-response.prompt.js';


describe('final-response.prompt', () => {
  it('should ask for a single final response envelope', () => {
    expect(FINAL_RESPONSE_INSTRUCTIONS).toContain('wrapped exactly once in <final_response>...</final_response>');
  });

  it('should require background work to finish before the final answer', () => {
    expect(FINAL_RESPONSE_INSTRUCTIONS).toContain('every subagent and background task you started must have finished');
    expect(FINAL_RESPONSE_REMINDER).toContain('<final_response>...</final_response>');
    expect(FINAL_RESPONSE_REMINDER).toContain('every subagent and background task you started has finished');
  });
});
