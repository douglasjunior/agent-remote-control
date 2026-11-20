/** The board in brief at the start of the CEO's turn. */
export function buildBoardPrompt(digest: string): string {
  return `[BOARD]\n${digest}\n`;
}

export type BoardCheckTask = {
  readonly id: string;
  readonly title: string;
  readonly status: string;
};

/** Sends the CEO back to tasks its turn was about to leave in the middle of the flow with no agent working on them. */
export function buildBoardCheckPrompt(tasks: readonly BoardCheckTask[]): string {
  return [
    '[BOARD_CHECK]',
    'Your turn was about to end while these tasks are in the middle of the flow with no agent working on them:',
    ...tasks.map(task => `- ${task.id} "${task.title}" · status: ${task.status}`),
    'Delegate the next step of each one, or give your answer to the user again saying what each one waits for.',
    '',
  ].join('\n');
}
