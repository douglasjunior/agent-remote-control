import { describe, expect, it } from 'vitest';

import { buildSessionContext } from './session-context.fixture.js';
import { StubAgentPort } from './stub-agent.port.js';


describe('buildSessionContext', () => {
  it('should use the agent port as active port by default', () => {
    const session = buildSessionContext();

    expect(session.agentPort).toBeInstanceOf(StubAgentPort);
    expect(session.activeAgentPort).toBe(session.agentPort);
  });

  it('should apply overrides', () => {
    const agentPort = new StubAgentPort();
    const activeAgentPort = new StubAgentPort();

    const session = buildSessionContext({ sessionId: 'sess-x', agentPort, activeAgentPort });

    expect(session.sessionId).toBe('sess-x');
    expect(session.agentPort).toBe(agentPort);
    expect(session.activeAgentPort).toBe(activeAgentPort);
  });
});
