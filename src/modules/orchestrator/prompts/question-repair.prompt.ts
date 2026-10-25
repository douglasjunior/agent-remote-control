export function buildQuestionRepairPrompt(reason: string): string {
  return [
    '[QUESTION_ERROR]',
    'The orchestrator could not read the questions in your previous response.',
    '',
    'Reason (fix exactly this):',
    reason,
    '',
    'Answer again inside the final response block. Write each question as <question rationale="why the answer matters">question text, followed by one <option>choice</option> per plausible answer</question>, or answer without any <question> tag if you no longer need the user.',
  ].join('\n');
}
