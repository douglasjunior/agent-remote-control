export function buildDelegationRepairPrompt(reason: string): string {
  return [
    '[DELEGATION_ERROR]',
    'The orchestrator could not process your previous response.',
    '',
    'Reason (fix exactly this):',
    reason,
    '',
    'Answer again following the Response Protocol, inside the final response block:',
    '- To delegate, write each task specification inside <delegate role="ROLE" project="project-folder">...</delegate>.',
    '- To answer the user and end the turn, write without any <delegate> tag, adding <attachment path="/absolute/path">description</attachment> for each file to send.',
    '- Text outside the tags is shown to the user; never mention the tags.',
  ].join('\n');
}
