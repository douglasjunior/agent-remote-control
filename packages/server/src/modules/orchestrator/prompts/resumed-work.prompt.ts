/**
 * Repeats the task because resuming the session may fail, and a session created in its place knows nothing of it.
 * The interrupted round may have changed files before it stopped, hence the check before continuing.
 */
export function buildResumedWorkPrompt(taskSpec: string): string {
  return [
    '[RESUMED_WORK]',
    'Your work on this task was interrupted and your last round may have been cut short. Check the current state of the files, do not redo finished work and continue until the task is done.',
    '',
    'Your task:',
    taskSpec,
  ].join('\n');
}

/** Precedes what a waiting agent receives when its session could not be resumed and it no longer knows its task. */
export function buildLostSessionTaskPrompt(taskSpec: string): string {
  return ['[LOST_SESSION]', 'Your previous session could not be recovered, so this is the task you were working on:', taskSpec].join('\n');
}
