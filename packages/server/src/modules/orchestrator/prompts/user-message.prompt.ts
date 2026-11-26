/**
 * A message the user sent while the CEO works, steered into its running prompt or read with its next one. Without the
 * instruction to keep working, models tend to answer the message alone and end the round with the task unfinished.
 */
export function buildUserMessagePrompt(message: string): string {
  return [
    '[USER_MESSAGE]',
    'The user sent a new message while you are working.',
    'Keep working on the current task until it is complete, taking this message into account, and answer everything in your final response:',
    '',
    message,
  ].join('\n');
}
