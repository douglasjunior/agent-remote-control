import { describe, expect, it } from 'vitest';

import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';


describe('final-response.prompt', () => {
  it('should ask for a single final response envelope', () => {
    expect(FINAL_RESPONSE_INSTRUCTIONS).toContain('wrapped exactly once in <final_response>...</final_response>');
  });
});
