import { describe, expect, it } from 'vitest';

import { buildDelegationRepairPrompt } from './delegation-repair.prompt.js';


describe('buildDelegationRepairPrompt', () => {
  it('should include the failure reason and restate the delegation protocol', () => {
    const prompt = buildDelegationRepairPrompt('Unknown role "QA".');

    expect(prompt.startsWith('[DELEGATION_ERROR]')).toBe(true);
    expect(prompt).toContain('Unknown role "QA".');
    expect(prompt).toContain('[DELEGATE:ROLE:project-folder] alone on the last line');
    expect(prompt).toContain('[DONE] alone on the last line');
    expect(prompt).toContain('inside the final response block');
  });
});
