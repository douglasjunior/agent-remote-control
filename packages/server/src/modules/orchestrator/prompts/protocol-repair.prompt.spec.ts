import { describe, expect, it } from '@rstest/core';

import { buildProtocolRepairPrompt } from './protocol-repair.prompt.js';


describe('buildProtocolRepairPrompt', () => {
  it('should name the tags written outside the final response block and ask for the answer again', () => {
    expect(buildProtocolRepairPrompt(['artifact_list', 'delegate'])).toBe([
      '[PROTOCOL_ERROR]',
      'Your previous response wrote <artifact_list>, <delegate> outside the <final_response> block, where text is only progress narration, so nothing was done with it.',
      'Answer again with every protocol tag, and the text that goes with it, inside a single <final_response>...</final_response> block.',
    ].join('\n'));
  });
});
