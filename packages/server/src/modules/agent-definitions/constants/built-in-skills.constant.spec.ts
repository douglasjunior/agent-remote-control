import { describe, expect, it } from 'vitest';

import { AGENT_ROLES } from '../models/agent-role.type.js';

import { BUILT_IN_SKILLS } from './built-in-skills.constant.js';


describe('built-in-skills.constant', () => {
  it('should name each skill once, in kebab-case, for known roles', () => {
    const names = BUILT_IN_SKILLS.map(skill => skill.name);

    expect(new Set(names).size).toBe(names.length);
    for (const skill of BUILT_IN_SKILLS) {
      expect(skill.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(skill.description.length).toBeLessThanOrEqual(1024);
      expect(skill.roles.length).toBeGreaterThan(0);
      expect(skill.roles.every(role => (AGENT_ROLES as readonly string[]).includes(role))).toBe(true);
    }
  });

  it('should keep the orchestration skills with the CEO and the testing skills with QA', () => {
    const rolesOf = (name: string) => BUILT_IN_SKILLS.find(skill => skill.name === name)?.roles;

    for (const name of ['agent-team', 'artifact-board', 'delegation-protocol', 'response-protocol', 'workspace-navigation', 'skill-authoring']) {
      expect(rolesOf(name)).toEqual(['CEO']);
    }
    for (const name of ['running-the-app', 'web-ui-testing', 'api-testing', 'mobile-testing']) {
      expect(rolesOf(name)).toEqual(['QA']);
    }
  });

  it('should open every content with its title', () => {
    for (const skill of BUILT_IN_SKILLS) {
      expect(skill.buildContent({ team: [], workspaceDir: '/ws' }).startsWith('# ')).toBe(true);
    }
  });
});
