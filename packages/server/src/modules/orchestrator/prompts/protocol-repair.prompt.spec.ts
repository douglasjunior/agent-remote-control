import { describe, expect, it } from '@rstest/core';

import { buildFinalResponseCountRepairPrompt, buildProtocolRepairPrompt } from './protocol-repair.prompt.js';


describe('buildProtocolRepairPrompt', () => {
  it('should name the tags written outside the final response block and ask for the answer again', () => {
    expect(buildProtocolRepairPrompt(['artifact_list', 'delegate'])).toBe([
      '[PROTOCOL_ERROR]',
      'Your previous response wrote <artifact_list>, <delegate> outside the <final_response> block, where text is only progress narration, so nothing was done with it.',
      'Answer again with every protocol tag, and the text that goes with it, inside a single <final_response>...</final_response> block.',
    ].join('\n'));
  });
});

describe('buildFinalResponseCountRepairPrompt', () => {
  it('should say how many final response blocks the response had and ask for a single one', () => {
    expect(buildFinalResponseCountRepairPrompt(2)).toBe([
      '[PROTOCOL_ERROR]',
      'Your previous response had 2 <final_response> blocks, but a turn has exactly one, so nothing was done with it.',
      'Answer again with the whole answer, every protocol tag included, in a single <final_response>...</final_response> block at the end of the turn.',
    ].join('\n'));
  });
});
