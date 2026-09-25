import { describe, expect, it } from 'vitest';

import { buildSessionContext } from './session-context.fixture.js';


describe('buildSessionContext', () => {
  it('should build a CEO session with defaults', () => {
    const session = buildSessionContext();

    expect(session.sessionId).toBe('sess-1');
    expect(session.agentRole).toBe('CEO');
  });

  it('should apply overrides', () => {
    expect(buildSessionContext({ sessionId: 'sess-x' }).sessionId).toBe('sess-x');
  });
});
