import { describe, expect, it } from 'vitest';

import { buildCeoSteeringPrompt } from './ceo-steering.prompt.js';


describe('buildCeoSteeringPrompt', () => {
  it('should frame the message as a user message that does not replace the current task', () => {
    const prompt = buildCeoSteeringPrompt('Also update the README.');

    expect(prompt.startsWith('[USER_MESSAGE]')).toBe(true);
    expect(prompt).toContain('Keep working on the current task until it is complete');
    expect(prompt.endsWith('\n\nAlso update the README.')).toBe(true);
  });
});
