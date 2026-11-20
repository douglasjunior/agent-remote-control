import { describe, expect, it } from '@rstest/core';

import { AGENT_ROLES } from '../models/agent-role.type.js';
import { skillContext } from '../testing/skill-context.fixture.js';


import { BUILT_IN_SKILLS } from './built-in-skills.constant.js';
import { INITIAL_AGENT_DEFINITIONS } from './initial-agents.constant.js';
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
    for (const name of ['web-ui-testing', 'api-testing', 'mobile-testing']) {
      expect(rolesOf(name)).toEqual(['QA']);
    }
  });

  it('should let the designer run the app to look at it, as QA runs it to test it', () => {
    expect(BUILT_IN_SKILLS.find(skill => skill.name === SKILL_NAMES.runningTheApp)?.roles).toEqual(['QA', 'UX_DESIGNER']);
  });

  it('should give the roles that work on a repository the skills of their procedures', () => {
    const rolesOf = (name: string) => BUILT_IN_SKILLS.find(skill => skill.name === name)?.roles;

    expect(rolesOf(SKILL_NAMES.gitRemote)).toEqual(['DEVELOPER', 'GIT_OPS']);
    expect(rolesOf(SKILL_NAMES.repositorySetup)).toEqual(['GIT_OPS']);
    expect(rolesOf(SKILL_NAMES.reviewPublishing)).toEqual(['CODE_REVIEWER']);
    expect(rolesOf(SKILL_NAMES.runningChecks)).toEqual(['DEVELOPER', 'CODE_REVIEWER', 'QA']);
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

  describe('on the tools interface', () => {
    const FORBIDDEN = ['<artifact_', '<skill_', '<section', '<pull_request', 'request_result', 'mcp__', 'mcp.arc', 'arc-artifact', 'arc-skill', 'arc: '];
    const readings = BUILT_IN_SKILLS.flatMap(skill => skill.roles.map((role) => {
      const definition = INITIAL_AGENT_DEFINITIONS.find(candidate => candidate.role === role)!;
      const team = INITIAL_AGENT_DEFINITIONS.filter(other => other !== definition);
      const context = (agentInterface: 'tags' | 'tools') => skillContext({
        team,
        artifacts: definition.artifacts,
        rolePrompt: definition.buildSystemPrompt(team, agentInterface),
        agentInterface,
      });
      return [`${skill.name} read by ${role}`, skill.buildContent(context('tools')), skill.buildContent(context('tags'))] as const;
    }));

    it.each(readings)('should write no request tag and no prefixed tool name in %s', (_reading, tools) => {
      for (const forbidden of FORBIDDEN) {
        expect(tools).not.toContain(forbidden);
      }
    });

    it.each(readings)('should keep %s at most as long as on the tags interface', (_reading, tools, tags) => {
      expect(tools.length).toBeLessThanOrEqual(tags.length);
    });

    it('should describe every skill without a board or skill request tag, since the catalog goes to both interfaces', () => {
      for (const skill of BUILT_IN_SKILLS) {
        expect(skill.description).not.toContain('<artifact_');
        expect(skill.description).not.toContain('<skill_');
      }
    });
  });
});
