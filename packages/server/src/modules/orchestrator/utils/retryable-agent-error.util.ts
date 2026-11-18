import { AgentAuthRequiredError, AgentBinaryNotFoundError } from '../../agent/ports/agent.port.js';

import { isPromptCancellation } from './prompt-cancellation.util.js';


/** Whether sending the prompt again can succeed: a cancellation was asked for, and a missing login or CLI needs a person. */
export function isRetryableAgentError(error: unknown): boolean {
  return !isPromptCancellation(error)
    && !(error instanceof AgentAuthRequiredError)
    && !(error instanceof AgentBinaryNotFoundError);
}
