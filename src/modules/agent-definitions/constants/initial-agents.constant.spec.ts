import { describe, expect, it } from 'vitest';

import { INITIAL_AGENT_DEFINITIONS } from './initial-agents.constant.js';


describe('initial-agents.constant', () => {
  it('should contain definitions for CEO, TECH_LEAD, DEVELOPER, and CODE_REVIEWER roles', () => {
    const roles = INITIAL_AGENT_DEFINITIONS.map(def => def.role);
    expect(roles).toContain('CEO');
    expect(roles).toContain('TECH_LEAD');
    expect(roles).toContain('DEVELOPER');
    expect(roles).toContain('CODE_REVIEWER');
    expect(INITIAL_AGENT_DEFINITIONS).toHaveLength(4);
  });

  it('should have valid names, descriptions, and system prompts for each agent', () => {
    for (const definition of INITIAL_AGENT_DEFINITIONS) {
      expect(definition.name).toBeTruthy();
      expect(definition.description).toBeTruthy();
      expect(definition.turnReminder).toBeTruthy();
      expect(definition.buildSystemPrompt([])).toBeTruthy();
    }
  });

  it('should describe CODE_REVIEWER as inspecting diffs and publishing review comments on PRs/MRs', () => {
    const codeReviewer = INITIAL_AGENT_DEFINITIONS.find(def => def.role === 'CODE_REVIEWER');
    expect(codeReviewer?.description).toContain('publishing review comments on PRs/MRs when requested');
  });
});
