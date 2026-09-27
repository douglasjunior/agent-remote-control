import { describe, expect, it } from 'vitest';

import { INITIAL_AGENT_DEFINITIONS } from './initial-agents.constant.js';


describe('initial-agents.constant', () => {
  it('should contain definitions for CEO, GIT_OPS, TECH_LEAD, DEVELOPER, and CODE_REVIEWER roles', () => {
    const roles = INITIAL_AGENT_DEFINITIONS.map(def => def.role);
    expect(roles).toContain('CEO');
    expect(roles).toContain('GIT_OPS');
    expect(roles).toContain('TECH_LEAD');
    expect(roles).toContain('DEVELOPER');
    expect(roles).toContain('CODE_REVIEWER');
    expect(INITIAL_AGENT_DEFINITIONS).toHaveLength(5);
  });

  it('should require a project folder for the agents that only work inside one', () => {
    const byRole = new Map(INITIAL_AGENT_DEFINITIONS.map(def => [def.role, def]));

    expect(byRole.get('DEVELOPER')?.delegation).toEqual({
      project: 'required',
      sessionMode: 'overridable',
    });
    expect(byRole.get('GIT_OPS')?.delegation).toEqual({
      project: 'optional',
      sessionMode: 'overridable',
    });
  });

  it('should keep the code reviewer session mode fixed so it cannot be resumed', () => {
    const reviewer = INITIAL_AGENT_DEFINITIONS.find(def => def.role === 'CODE_REVIEWER');

    expect(reviewer?.defaultSessionMode).toBe('new');
    expect(reviewer?.delegation.sessionMode).toBeUndefined();
  });

  it('should have valid names, descriptions, and system prompts for each agent', () => {
    for (const definition of INITIAL_AGENT_DEFINITIONS) {
      expect(definition.name).toBeTruthy();
      expect(definition.description).toBeTruthy();
      expect(definition.turnReminder).toBeTruthy();
      expect(definition.buildSystemPrompt([])).toBeTruthy();
    }
  });
});
