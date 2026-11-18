import { previewForLog } from '../utils/log-preview.util.js';


/** Sent in place of the prompt whose attempt failed: the agent may have done part of it before the error. */
export function buildAgentRetryPrompt(errorMessage: string, prompt: string): string {
  return [
    '[RETRY]',
    `Your previous attempt at the message below stopped with an error: ${previewForLog(errorMessage)}`,
    'What you already did is kept. Check the current state before repeating a step, then complete the message.',
    '',
    prompt,
  ].join('\n');
}
