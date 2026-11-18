import { describe, expect, it } from '@rstest/core';

import { buildAgentRetryPrompt } from './agent-retry.prompt.js';


describe('buildAgentRetryPrompt', () => {
  it('should tell the agent the error and keep the original prompt whole after it', () => {
    const prompt = buildAgentRetryPrompt('connection lost', 'Build the login.\nThen test it.');

    expect(prompt.startsWith('[RETRY]')).toBe(true);
    expect(prompt).toContain('stopped with an error: connection lost');
    expect(prompt).toContain('Check the current state before repeating a step');
    expect(prompt.endsWith('Build the login.\nThen test it.')).toBe(true);
  });

  it('should cut a long error to one short line', () => {
    const prompt = buildAgentRetryPrompt(`first line\n${'x'.repeat(500)}`, 'Go.');

    expect(prompt).not.toContain('x'.repeat(200));
    expect(prompt.split('\n')[1]).toContain('first line xxx');
  });
});
