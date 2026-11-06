import { describe, expect, it } from 'vitest';

import { buildPreviousTurnPrompt } from './previous-turn.prompt.js';


describe('buildPreviousTurnPrompt', () => {
  it('should list every notice under the block header', () => {
    const prompt = buildPreviousTurnPrompt(['First notice.', 'Second notice.']);

    expect(prompt.startsWith('[PREVIOUS_TURN]\n- First notice.\n- Second notice.\n')).toBe(true);
    expect(prompt).toContain('no agent is continuing it');
  });
});
