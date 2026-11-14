import { describe, expect, it } from 'vitest';

import { INITIAL_AGENT_DEFINITIONS } from './initial-agents.constant.js';


describe('initial-agents.constant', () => {
  it('should contain definitions for CEO, GIT_OPS, PRODUCT_OWNER, TECH_LEAD, DEVELOPER, CODE_REVIEWER and QA roles', () => {
    const roles = INITIAL_AGENT_DEFINITIONS.map(def => def.role);
    expect(roles).toContain('CEO');
    expect(roles).toContain('GIT_OPS');
    expect(roles).toContain('TECH_LEAD');
    expect(roles).toContain('DEVELOPER');
    expect(roles).toContain('CODE_REVIEWER');
    expect(roles).toContain('PRODUCT_OWNER');
    expect(roles).toContain('QA');
    expect(INITIAL_AGENT_DEFINITIONS).toHaveLength(7);
  });

  it('should test a reviewed task in practice, modifying the project while it runs', () => {
    const qa = INITIAL_AGENT_DEFINITIONS.find(def => def.role === 'QA');

    expect(qa?.delegation).toEqual({ project: 'required', sessionMode: 'overridable', artifact: 'required', needsReviewableWork: true });
    expect(qa?.artifacts).toEqual({ scope: 'task', sections: ['test_report'], fields: [] });
  });

  it('should require a project folder for the agents that only work inside one', () => {
    const byRole = new Map(INITIAL_AGENT_DEFINITIONS.map(def => [def.role, def]));

    expect(byRole.get('DEVELOPER')?.delegation).toEqual({
      project: 'required',
      sessionMode: 'overridable',
      artifact: 'required',
    });
    expect(byRole.get('GIT_OPS')?.delegation).toEqual({
      project: 'optional',
      sessionMode: 'overridable',
      artifact: 'optional',
    });
  });

  it('should review in a fresh session by default while still allowing an explicit resume', () => {
    const reviewer = INITIAL_AGENT_DEFINITIONS.find(def => def.role === 'CODE_REVIEWER');

    expect(reviewer?.defaultSessionMode).toBe('new');
    expect(reviewer?.delegation).toEqual({
      project: 'required',
      sessionMode: 'overridable',
      readOnly: true,
      artifact: 'required',
      needsReviewableWork: true,
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

  it('should send the CEO prompt with every turn and let only the CEO write skills', () => {
    const ceo = INITIAL_AGENT_DEFINITIONS.find(def => def.role === 'CEO');

    expect(ceo?.systemPromptEveryTurn).toBe(true);
    expect(ceo?.turnReminder).toBeUndefined();
    expect(INITIAL_AGENT_DEFINITIONS.filter(def => def.writesSkills).map(def => def.role)).toEqual(['CEO']);
  });

  it('should route project documented commands to DEVELOPER and keep them away from GIT_OPS', () => {
    const byRole = new Map(INITIAL_AGENT_DEFINITIONS.map(def => [def.role, def]));

    expect(byRole.get('DEVELOPER')?.description).toContain('runs the commands a project documents for itself');
    expect(byRole.get('GIT_OPS')?.description).toContain(
      'It does not run project scripts, even when they clone or fetch internally.',
    );
  });

  it('should run product discovery read-only, in or out of a project, before technical planning', () => {
    const owner = INITIAL_AGENT_DEFINITIONS.find(def => def.role === 'PRODUCT_OWNER');

    expect(owner?.delegation).toEqual({ project: 'optional', sessionMode: 'overridable', readOnly: true, artifact: 'optional' });
    expect(owner?.defaultSessionMode).toBe('resume');
    expect(owner?.description).toContain('before the Tech Lead');
    expect(owner?.description).toContain('interviews the user directly');
  });

  it('should describe CODE_REVIEWER as reviewing the work of a task without running the project', () => {
    const codeReviewer = INITIAL_AGENT_DEFINITIONS.find(def => def.role === 'CODE_REVIEWER');
    expect(codeReviewer?.description).toContain('its open pull request, or its branch reviewed locally when there is none');
    expect(codeReviewer?.description).toContain('never runs the project or its tests');
  });

  it('should give every agent its access to the board', () => {
    const byRole = new Map(INITIAL_AGENT_DEFINITIONS.map(def => [def.role, def]));

    expect(byRole.get('CEO')?.artifacts.scope).toBe('board');
    expect(byRole.get('PRODUCT_OWNER')?.artifacts.scope).toBe('tree');
    expect(byRole.get('TECH_LEAD')?.artifacts.scope).toBe('tree');
    for (const role of ['DEVELOPER', 'GIT_OPS', 'CODE_REVIEWER'] as const) {
      expect(byRole.get(role)?.artifacts.scope).toBe('task');
    }
  });
});
