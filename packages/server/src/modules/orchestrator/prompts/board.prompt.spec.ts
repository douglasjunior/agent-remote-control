import { describe, expect, it } from '@rstest/core';

import { buildBoardCheckPrompt, buildBoardPrompt } from './board.prompt.js';


describe('buildBoardPrompt', () => {
  it('should put the digest under the block header', () => {
    expect(buildBoardPrompt('No open artifact.')).toBe('[BOARD]\nNo open artifact.\n');
  });
});

describe('buildBoardCheckPrompt', () => {
  it('should list each task and tell the CEO what to do with them', () => {
    expect(buildBoardCheckPrompt([
      { id: 'T-4', title: 'Add the cart', status: 'in_progress' },
      { id: 'T-5', title: 'Pay', status: 'approved' },
    ])).toBe([
      '[BOARD_CHECK]',
      'Your turn was about to end while these tasks are in the middle of the flow with no agent working on them:',
      '- T-4 "Add the cart" · status: in_progress',
      '- T-5 "Pay" · status: approved',
      'Delegate the next step of each one, or give your answer to the user again saying what each one waits for.',
      '',
    ].join('\n'));
  });
});
