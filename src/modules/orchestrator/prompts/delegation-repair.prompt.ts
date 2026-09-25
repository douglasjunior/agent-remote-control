export function buildDelegationRepairPrompt(reason: string): string {
  return [
    '[DELEGATION_ERROR]',
    'The orchestrator could not process your previous response.',
    '',
    'Reason (fix exactly this):',
    reason,
    '',
    'Answer again following the Delegation Protocol:',
    '- To delegate, write the task specification and end with [DELEGATE:ROLE:project-folder] alone on the last line.',
    '- To finish, end with [DONE] alone on the last line.',
    '- To talk to the user, answer without any marker and without mentioning markers.',
  ].join('\n');
}
