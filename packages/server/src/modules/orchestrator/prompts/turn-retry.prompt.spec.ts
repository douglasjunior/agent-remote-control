import { describe, expect, it } from '@rstest/core';

import { buildTurnRetryPrompt } from './turn-retry.prompt.js';


describe('buildTurnRetryPrompt', () => {
  it('should tell the agent the error and keep the original prompt whole after it', () => {
    const prompt = buildTurnRetryPrompt({ errorMessage: 'connection lost' }, 'Build the login.\nThen test it.');

    expect(prompt.startsWith('[RETRY]')).toBe(true);
    expect(prompt).toContain('failed with this error: connection lost');
    expect(prompt).toContain('check what you already did before repeating a step');
    expect(prompt).not.toContain('The user wrote');
    expect(prompt.endsWith('Build the login.\nThen test it.')).toBe(true);
  });

  it('should carry what the user wrote while the retry was waiting', () => {
    const prompt = buildTurnRetryPrompt({ errorMessage: 'boom', userMessage: 'I logged in again.' }, 'Go.');

    expect(prompt).toContain('The user wrote while the retry was waiting: I logged in again.');
  });

  it('should put a long error with many lines on one line and cut it', () => {
    const prompt = buildTurnRetryPrompt({ errorMessage: `first line\n${'x'.repeat(2000)}` }, 'Go.');

    const errorLine = prompt.split('\n')[1]!;
    expect(errorLine).toContain('first line xxx');
    expect(errorLine.endsWith('...')).toBe(true);
    expect(errorLine.length).toBeLessThan(1200);
  });
});
