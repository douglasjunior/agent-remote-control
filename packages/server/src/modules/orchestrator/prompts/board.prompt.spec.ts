import { describe, expect, it } from '@rstest/core';

import { buildBoardCheckPrompt, buildBoardPrompt } from './board.prompt.js';


describe('buildBoardPrompt', () => {
  it('should put the digest under the block header', () => {
    expect(buildBoardPrompt('No open artifact.')).toBe('[BOARD]\nNo open artifact.\n');
  });
});

describe('buildBoardCheckPrompt', () => {
  it('should list each task, say the answer was not delivered and ask for a complete one, attachments included', () => {
    expect(buildBoardCheckPrompt([
      { id: 'T-4', title: 'Add the cart', status: 'in_progress' },
      { id: 'T-5', title: 'Pay', status: 'approved' },
    ])).toBe([
      '[BOARD_CHECK]',
      'Your answer was not delivered: your turn was about to end while these tasks it delegated are in the middle of the flow with no agent working on them:',
      '- T-4 "Add the cart" · status: in_progress',
      '- T-5 "Pay" · status: approved',
      'Delegate the next step of each one, or answer instead saying what each one waits for. Either way, the user gets only the answer that ends the turn: write it complete, with every <attachment> you were sending.',
      '',
    ].join('\n'));
  });
});
