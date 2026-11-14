import { PromptCancelledError } from '../../agent/ports/agent.port.js';


/** Matches by name too, since an error crossing a module copy of the class fails `instanceof`. */
export function isPromptCancellation(error: unknown): boolean {
  return error instanceof PromptCancelledError
    || (error instanceof Error && error.name === 'PromptCancelledError');
}
