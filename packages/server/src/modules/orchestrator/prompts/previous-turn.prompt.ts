/** Tells the CEO what its last turn left undone, which its own session records as delegated and still underway. */
export function buildPreviousTurnPrompt(notices: readonly string[]): string {
  return [
    '[PREVIOUS_TURN]',
    ...notices.map(notice => `- ${notice}`),
    'None of this work completed and no agent is continuing it. Redo what still matters for the user, or tell them what was left undone.',
    '',
  ].join('\n');
}
