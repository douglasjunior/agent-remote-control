import { describe, expect, it } from '@rstest/core';

import { buildPreviousTurnPrompt, describeDelegation } from './previous-turn.prompt.js';


describe('buildPreviousTurnPrompt', () => {
  it('should list every notice under the block header', () => {
    const prompt = buildPreviousTurnPrompt(['First notice.', 'Second notice.']);

    expect(prompt.startsWith('[PREVIOUS_TURN]\n- First notice.\n- Second notice.\n')).toBe(true);
    expect(prompt).toContain('no agent is continuing it');
  });

  it('should name a delegation by its role, project and task', () => {
    expect(describeDelegation('DEVELOPER', 'shop', 'Build it')).toBe('DEVELOPER (Project: shop, Task: "Build it")');
    expect(describeDelegation('GIT_OPS', null, 'Clone')).toBe('GIT_OPS (Project: none, Task: "Clone")');
  });
});
