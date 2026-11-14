import { describe, expect, it } from 'vitest';

import { skillContext } from '../testing/skill-context.fixture.js';

import { SKILL_AUTHORING_SKILL } from './skill-authoring.skill.js';


describe('skill-authoring skill', () => {
  const skill = SKILL_AUTHORING_SKILL.buildContent(skillContext({ workspaceDir: '/home/user/workspaces' }));

  it('should be read by the CEO only, when the user asks for a skill', () => {
    expect(SKILL_AUTHORING_SKILL).toMatchObject({ name: 'skill-authoring', roles: ['CEO'] });
    expect(SKILL_AUTHORING_SKILL.description).toContain('Use when the user asks to create, change or review a skill');
  });

  it('should start from the existing skills and write through requests, never files', () => {
    expect(skill).toContain('List every skill with `<skill_list/>`');
    expect(skill).toContain('read it first with `<skill_read name="..."/>` (you can read any skill)');
    expect(skill).toContain('you never write skill files yourself');
    expect(skill).toContain('Writing replaces the whole skill, so an update carries the full content.');
  });

  it('should give the grammar and the shape of each field', () => {
    expect(skill).toContain('<skill_write name="electron-testing" roles="QA" description="');
    expect(skill).toContain('`name`: lowercase kebab-case, up to 64 characters');
    expect(skill).toContain('`roles`: the roles that read it, comma-separated');
    expect(skill).toContain('`description`: one or two sentences, up to 1024 characters: what the skill covers, then when to read it');
  });

  it('should keep the content in English, prescriptive and within the role limits', () => {
    expect(skill).toContain('In English, whatever the language of the conversation');
    expect(skill).toContain('Prescriptive and concrete');
    expect(skill).toContain('a skill never asks an agent to do what its role forbids');
    expect(skill).toContain('No secrets, tokens or personal data');
  });
});
