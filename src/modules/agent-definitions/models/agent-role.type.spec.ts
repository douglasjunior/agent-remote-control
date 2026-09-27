import { describe, expect, it } from 'vitest';

import { AGENT_ROLES } from './agent-role.type.js';


describe('agent-role.type', () => {
  it('should define CEO, GIT_OPS, DEVELOPER, CODE_REVIEWER, and TECH_LEAD roles in AGENT_ROLES', () => {
    expect(AGENT_ROLES).toContain('CEO');
    expect(AGENT_ROLES).toContain('GIT_OPS');
    expect(AGENT_ROLES).toContain('DEVELOPER');
    expect(AGENT_ROLES).toContain('CODE_REVIEWER');
    expect(AGENT_ROLES).toContain('TECH_LEAD');
    expect(AGENT_ROLES).toHaveLength(5);
  });
});
