import { describe, expect, it } from 'vitest';

import { buildDelegationRepairPrompt } from './delegation-repair.prompt.js';


describe('buildDelegationRepairPrompt', () => {
  it('should include the failure reason and restate the delegation protocol', () => {
    const prompt = buildDelegationRepairPrompt('Unknown role "QA".');

    expect(prompt.startsWith('[DELEGATION_ERROR]')).toBe(true);
    expect(prompt).toContain('Unknown role "QA".');
    expect(prompt).toContain('<delegate role="ROLE" project="project-folder">...</delegate>');
    expect(prompt).toContain('write without any <delegate> tag, adding <attachment path="/absolute/path">description</attachment>');
    expect(prompt).toContain('To ask the user, write each question as <question rationale="why the answer matters">');
    expect(prompt).toContain('Text outside the tags is shown to the user');
    expect(prompt).toContain('inside the final response block');
  });
});
