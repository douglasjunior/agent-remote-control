/** Tells the CEO what its last turn left undone, which its own session records as delegated and still underway. */
export function buildPreviousTurnPrompt(notices: readonly string[]): string {
  return [
    '[PREVIOUS_TURN]',
    ...notices.map(notice => `- ${notice}`),
    'None of this work completed and no agent is continuing it. Redo what still matters for the user, or tell them what was left undone.',
    '',
  ].join('\n');
}

/** Names a delegation in a notice: its role, project and task. */
export function describeDelegation(role: string, projectName: string | null, taskSpec: string): string {
  return `${role} (Project: ${projectName ?? 'none'}, Task: "${taskSpec}")`;
}

/** The messages of the user a turn that did not complete read while it ran, which its answer never reached. */
export function describeReadMessages(messages: readonly string[]): string {
  return `It had read these messages the user sent while it ran: ${messages.map(message => JSON.stringify(message)).join(', ')}.`;
}
