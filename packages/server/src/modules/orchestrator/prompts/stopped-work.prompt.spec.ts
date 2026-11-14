import { describe, expect, it } from 'vitest';

import { buildStoppedWorkPrompt } from './stopped-work.prompt.js';


describe('stopped-work.prompt', () => {
  it('should say who stopped the agent and that its changes stay in the project for the user to decide on', () => {
    expect(buildStoppedWorkPrompt('T-1', 'cancelled', 'shop')).toBe(
      'The user moved T-1 to cancelled on the board, which stopped this agent before it finished. What it changed in project "shop" before stopping stays there as it left it, possibly half done: tell the user, so they decide whether to keep or discard it.',
    );
  });
});
