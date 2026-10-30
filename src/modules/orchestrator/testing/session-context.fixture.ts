import type { SessionContext } from '../models/session-context.model.js';


export function buildSessionContext(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    conversationId: 'conv-1',
    agentSessions: [],
    ...overrides,
  };
}
