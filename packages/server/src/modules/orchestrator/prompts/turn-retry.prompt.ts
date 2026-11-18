import type { RetryNote } from '../models/turn-retry.model.js';


const MAX_ERROR_LENGTH = 1000;

/** The prompt of a round again, after the error that stopped it: the agent may have done part of the work before it. */
export function buildTurnRetryPrompt({ errorMessage, userMessage }: RetryNote, prompt: string): string {
  const error = errorMessage.replace(/\s+/g, ' ').trim();
  return [
    '[RETRY]',
    `Your previous attempt at the message below failed with this error: ${error.length > MAX_ERROR_LENGTH ? `${error.slice(0, MAX_ERROR_LENGTH)}...` : error}`,
    'Fix what caused it, and check what you already did before repeating a step. Then complete the message.',
    ...(userMessage ? ['', `The user wrote while the retry was waiting: ${userMessage}`] : []),
    '',
    prompt,
  ].join('\n');
}
