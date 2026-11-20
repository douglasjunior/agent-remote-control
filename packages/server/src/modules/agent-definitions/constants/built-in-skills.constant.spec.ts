import { describe, expect, it } from '@rstest/core';

import { AGENT_ROLES } from '../models/agent-role.type.js';
import { skillContext } from '../testing/skill-context.fixture.js';


import { BUILT_IN_SKILLS } from './built-in-skills.constant.js';
import { SKILL_NAMES } from './skill-names.constant.js';


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

  it('should name each built-in skill from the catalog of names, and give each name a skill', () => {
    expect(BUILT_IN_SKILLS.map(skill => skill.name).sort()).toEqual(Object.values(SKILL_NAMES).sort());
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

  it('should give the roles that work on a repository the skills of their procedures', () => {
    const rolesOf = (name: string) => BUILT_IN_SKILLS.find(skill => skill.name === name)?.roles;

    expect(rolesOf(SKILL_NAMES.gitRemote)).toEqual(['DEVELOPER', 'GIT_OPS']);
    expect(rolesOf(SKILL_NAMES.repositorySetup)).toEqual(['GIT_OPS']);
    expect(rolesOf(SKILL_NAMES.reviewPublishing)).toEqual(['CODE_REVIEWER']);
  });

  it('should let every executor role, and only them, read the role guide', () => {
    const roleGuide = BUILT_IN_SKILLS.find(skill => skill.name === SKILL_NAMES.roleGuide);

    expect([...(roleGuide?.roles ?? [])].sort()).toEqual(AGENT_ROLES.filter(role => role !== 'CEO').sort());
  });

  it('should give every skill a description that says when to read it', () => {
    for (const skill of BUILT_IN_SKILLS) {
      expect(skill.description).toMatch(/\b(Read|Use)\b/);
    }
  });

  it('should open every content with its title, but for the role guide, which is the prompt of the reader', () => {
    for (const skill of BUILT_IN_SKILLS.filter(candidate => candidate.name !== SKILL_NAMES.roleGuide)) {
      expect(skill.buildContent(skillContext({ workspaceDir: '/ws' })).startsWith('# ')).toBe(true);
    }
  });
});
