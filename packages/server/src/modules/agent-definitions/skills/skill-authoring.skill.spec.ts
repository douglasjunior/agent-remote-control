import { describe, expect, it } from '@rstest/core';

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

  it('should give a complete skill to copy, and the file the server stores it as', () => {
    expect(skill).toContain('A complete request, to copy and adapt:');
    expect(skill).toContain('## Setup\n');
    expect(skill).toContain('## When It Fails\n');
    expect(skill).toContain('---\nname: electron-testing\ndescription: Testing an Electron desktop app');
    expect(skill).toContain('\nroles: QA\n---\n# Testing an Electron App');
  });

  it('should write a process skill for every role it governs, one section per role', () => {
    expect(skill).toContain('names every role it governs in `roles`, yours included, and has one section per role');
    expect(skill).toContain('A process skill only you can read forces you to repeat the process in every delegation.');
  });

  it('should keep the content in English, prescriptive and within the role limits', () => {
    expect(skill).toContain('In English, whatever the language of the conversation');
    expect(skill).toContain('Prescriptive and concrete');
    expect(skill).toContain('a skill never asks an agent to do what its role forbids');
    expect(skill).toContain('No secrets, tokens or personal data');
  });

  describe('on the tools interface', () => {
    const tools = SKILL_AUTHORING_SKILL.buildContent(skillContext({ agentInterface: 'tools' }));

    it('should list, read and write skills with the tools', () => {
      expect(tools).toContain('You write skills with the `skill_write` tool, and the server stores them; you never write skill files yourself.');
      expect(tools).toContain('List every skill with `skill_list`');
      expect(tools).toContain('read it first with `skill_read` (you can read any skill)');
      expect(tools).toContain('3. Write it with `skill_write`. Writing replaces the whole skill');
    });

    it('should give a complete skill to copy as its fields, without the request grammar', () => {
      expect(tools).toContain('A complete skill, to copy and adapt: the name `electron-testing`, the role `QA`, the description "Testing an Electron desktop app');
      expect(tools).toContain('## When It Fails\n');
      expect(tools).toContain('- `content`: the whole skill, in Markdown.');
      expect(tools).toContain('The server stores the skill above as `skills/electron-testing/SKILL.md`');
      expect(tools).not.toContain('<skill_');
    });

    it('should keep the guidance on writing the content', () => {
      expect(tools).toContain('A process skill only you can read forces you to repeat the process in every delegation.');
    });
  });
});
