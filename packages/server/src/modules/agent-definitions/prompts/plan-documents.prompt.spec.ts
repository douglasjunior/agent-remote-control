import { describe, expect, it } from 'vitest';

import { buildPlanDocumentInstructions, buildPlanDocumentReminder } from './plan-documents.prompt.js';


describe('plan-documents.prompt', () => {
  it('should send the agent to the initiative folder of the plans directory', () => {
    const instructions = buildPlanDocumentInstructions('plan.md');

    expect(instructions).toContain('`[PLANS_DIRECTORY]`');
    expect(instructions).toContain('`<YYYY-MM-DD>-<short-slug>`');
    expect(instructions).toContain('The only file you may write is `plan.md`');
    expect(instructions).toContain('updates the same file in place');
    expect(instructions).toContain('the absolute path of `plan.md`');
  });

  it('should name the document of each agent in the instructions and in the reminder', () => {
    expect(buildPlanDocumentInstructions('intent.md')).toContain('The only file you may write is `intent.md`');
    expect(buildPlanDocumentReminder('intent.md')).toContain('Your deliverable is `intent.md`');
    expect(buildPlanDocumentReminder('plan.md')).toContain('Your deliverable is `plan.md`');
  });
});
