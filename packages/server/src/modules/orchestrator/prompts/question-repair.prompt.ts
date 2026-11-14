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

/** For an agent that does not ask the user: the decision goes back to whoever delegated the work. */
export function buildQuestionNotAllowedPrompt(): string {
  return [
    '[QUESTION_ERROR]',
    'You do not ask the user. Answer again inside the final response block, without any <question> tag: end your turn with the decision you need and the options you see, for whoever delegated the work to take to the user.',
  ].join('\n');
}
