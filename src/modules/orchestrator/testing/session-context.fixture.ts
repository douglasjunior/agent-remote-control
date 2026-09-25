import type { IAgentPort } from '../../agent/ports/agent.port.js';
import type { SessionContext } from '../models/session-context.model.js';

import { StubAgentPort } from './stub-agent.port.js';


export function buildSessionContext(
  overrides: Partial<SessionContext> & { agentPort?: IAgentPort } = {},
): SessionContext {
  const agentPort = overrides.agentPort ?? new StubAgentPort();
  return {
    sessionId: 'sess-1',
    channelId: 'ch-1',
    userId: 'user-1',
    workspacePath: '/mock/workspace',
    agentRole: 'CEO',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
    agentPort,
    activeAgentPort: overrides.activeAgentPort ?? agentPort,
  };
}
