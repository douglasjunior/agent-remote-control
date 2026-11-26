import { describe, expect, it } from '@rstest/core';

import { buildDelegationRepairPrompt } from './delegation-repair.prompt.js';


describe('buildDelegationRepairPrompt', () => {
  it('should include the failure reason and restate the delegation protocol', () => {
    const prompt = buildDelegationRepairPrompt('Unknown role "QA".');

    expect(prompt.startsWith('[DELEGATION_ERROR]')).toBe(true);
    expect(prompt).toContain('Unknown role "QA".');
    expect(prompt).toContain('<delegate role="ROLE" summary="what the user reads" project="project-folder">...</delegate>');
    expect(prompt).toContain('write without any <delegate> tag, adding <attachment path="/absolute/path">description</attachment>');
    expect(prompt).toContain('To ask the user, write each question as <question rationale="why the answer matters">');
    expect(prompt).toContain('with your whole response inside one <final_response>...</final_response> block');
    expect(prompt).toContain('Inside the block, text outside the tags is shown to the user');
    expect(prompt).toContain('Text outside the block is only progress narration.');
  });
});
