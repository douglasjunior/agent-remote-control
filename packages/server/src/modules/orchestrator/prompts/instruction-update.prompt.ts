const BACKGROUND_WORK_REMINDER = 'A tool call or command you had running may have moved to the background when this message arrived: before your final response, wait for it and for every subagent and background task you started, and read their results.';

function artifactBlock(artifactContext: string | undefined): string[] {
  return artifactContext ? ['', 'Your artifact as it stands now:', artifactContext] : [];
}

/**
 * Reaches an agent at work, in its running prompt or with its next one. Without the instruction to keep working,
 * models tend to answer the new text alone and drop the task; without the reminder, an agent whose tool call the
 * message moved to the background answers before its result.
 */
export function buildInstructionUpdatePrompt(instructions: readonly string[], artifactContext?: string): string {
  return [
    '[INSTRUCTION_UPDATE]',
    'The CEO updated your instructions while you work. Keep working on your task with them from now on: they take precedence over what they contradict, and the rest of your task still stands. Answer everything in your final response.',
    ...artifactBlock(artifactContext),
    '',
    instructions.length > 1 ? 'New instructions, in the order they were sent:' : 'New instruction:',
    instructions.join('\n\n'),
    '',
    BACKGROUND_WORK_REMINDER,
    '[/INSTRUCTION_UPDATE]',
  ].join('\n');
}

/** The next instruction on the same work, sent in the same session once the agent's previous final response was delivered. */
export function buildFollowUpPrompt(instruction: string, artifactContext?: string): string {
  return [
    '[FOLLOW_UP]',
    'Your previous final response was delivered. The CEO sends this next instruction on the same work, in this same session.',
    ...artifactBlock(artifactContext),
    '',
    instruction,
    '[/FOLLOW_UP]',
  ].join('\n');
}
