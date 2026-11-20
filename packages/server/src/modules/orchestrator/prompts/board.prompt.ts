/** The board in brief at the start of the CEO's turn. */
export function buildBoardPrompt(digest: string): string {
  return `[BOARD]\n${digest}\n`;
}

export type BoardCheckTask = {
  readonly id: string;
  readonly title: string;
  readonly status: string;
};

/**
 * Sends the CEO back to tasks its turn delegated and was about to leave in the middle of the flow with no agent
 * working on them. The answer it gave is discarded with its attachments, so the next one has to stand on its own.
 */
export function buildBoardCheckPrompt(tasks: readonly BoardCheckTask[]): string {
  return [
    '[BOARD_CHECK]',
    'Your answer was not delivered: your turn was about to end while these tasks it delegated are in the middle of the flow with no agent working on them:',
    ...tasks.map(task => `- ${task.id} "${task.title}" · status: ${task.status}`),
    'Delegate the next step of each one, or answer instead saying what each one waits for. Either way, the user gets only the answer that ends the turn: write it complete, with every <attachment> you were sending.',
    '',
  ].join('\n');
}
