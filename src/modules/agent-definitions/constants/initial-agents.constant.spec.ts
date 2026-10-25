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

  it('should review in a fresh session by default while still allowing an explicit resume', () => {
    const reviewer = INITIAL_AGENT_DEFINITIONS.find(def => def.role === 'CODE_REVIEWER');

    expect(reviewer?.defaultSessionMode).toBe('new');
    expect(reviewer?.delegation).toEqual({
      project: 'required',
      sessionMode: 'overridable',
    });
  });

  it('should have valid names, descriptions, and system prompts for each agent', () => {
    for (const definition of INITIAL_AGENT_DEFINITIONS) {
      expect(definition.name).toBeTruthy();
      expect(definition.description).toBeTruthy();
      expect(definition.turnReminder ?? definition.systemPromptEveryTurn).toBeTruthy();
      expect(definition.buildSystemPrompt([])).toBeTruthy();
    }
  });

  it('should send the CEO prompt with every turn and give it workspace guidance files', () => {
    const ceo = INITIAL_AGENT_DEFINITIONS.find(def => def.role === 'CEO');

    expect(ceo?.systemPromptEveryTurn).toBe(true);
    expect(ceo?.turnReminder).toBeUndefined();
    expect(ceo?.buildWorkspaceFiles?.([], '/ws').map(file => file.path)).toContain('AGENTS.md');
  });

  it('should route project documented commands to DEVELOPER and keep them away from GIT_OPS', () => {
    const byRole = new Map(INITIAL_AGENT_DEFINITIONS.map(def => [def.role, def]));

    expect(byRole.get('DEVELOPER')?.description).toContain('runs the commands a project documents for itself');
    expect(byRole.get('GIT_OPS')?.description).toContain(
      'It does not run project scripts, even when they clone or fetch internally.',
    );
  });

  it('should describe CODE_REVIEWER as inspecting diffs and publishing review comments on PRs/MRs', () => {
    const codeReviewer = INITIAL_AGENT_DEFINITIONS.find(def => def.role === 'CODE_REVIEWER');
    expect(codeReviewer?.description).toContain('publishing review comments on PRs/MRs when requested');
  });
});
