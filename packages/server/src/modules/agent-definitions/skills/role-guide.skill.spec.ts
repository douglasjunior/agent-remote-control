import { describe, expect, it } from '@rstest/core';

import { AGENT_ROLES } from '../models/agent-role.type.js';
import { skillContext } from '../testing/skill-context.fixture.js';

import { ROLE_GUIDE_SKILL } from './role-guide.skill.js';


describe('role-guide skill', () => {
  it('should be read by every executor role and not by the CEO, whose prompt arrives every turn', () => {
    expect(ROLE_GUIDE_SKILL.name).toBe('role-guide');
    expect([...ROLE_GUIDE_SKILL.roles].sort()).toEqual(AGENT_ROLES.filter(role => role !== 'CEO').sort());
  });

  it('should give the system prompt of the reader as its content', () => {
    expect(ROLE_GUIDE_SKILL.buildContent(skillContext({ rolePrompt: 'You are the Example Agent.' }))).toBe('You are the Example Agent.');
  });
});
