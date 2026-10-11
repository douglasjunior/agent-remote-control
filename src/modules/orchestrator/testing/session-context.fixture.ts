import type { SessionContext } from '../models/session-context.model.js';


export function buildSessionContext(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: 'sess-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    workspacePath: '/mock/workspace',
    agentRole: 'CEO',
    agentSessions: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}
