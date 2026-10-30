import { describe, expect, it } from 'vitest';

import { buildSessionContext } from './session-context.fixture.js';


describe('buildSessionContext', () => {
  it('should build an empty session with defaults', () => {
    expect(buildSessionContext()).toEqual({ conversationId: 'conv-1', agentSessions: [] });
  });

  it('should apply overrides', () => {
    expect(buildSessionContext({ conversationId: 'conv-x' }).conversationId).toBe('conv-x');
  });
});
