import { describe, expect, it } from 'vitest';

import type { AgentSkillInput } from '../../orchestrator/models/agent-skill.model.js';
import { workspaceDirectoryAt } from '../../paths/testing/fixed-directories.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';
import type { IUserSkillStorePort } from '../ports/user-skill-store.port.js';

import { AgentRegistryService } from './agent-registry.service.js';
import { AgentSkillsService } from './agent-skills.service.js';


class StubUserSkillStore implements IUserSkillStorePort {
  skills: AgentSkillDefinition[] = [];
  readonly written: AgentSkillInput[] = [];

  async list(): Promise<readonly AgentSkillDefinition[]> {
    return this.skills;
  }

  async delete(name: string): Promise<boolean> {
    const before = this.skills.length;
    this.skills = this.skills.filter(skill => skill.name !== name);
    return this.skills.length < before;
  }

  async write(skill: AgentSkillInput): Promise<boolean> {
    this.written.push(skill);
    return !this.skills.some(existing => existing.name === skill.name);
  }
}

const userSkill = (name: string, roles: readonly string[], content = 'Run it.'): AgentSkillDefinition =>
  ({ name, description: `${name} skill.`, roles, buildContent: () => content });

const input = (overrides: Partial<AgentSkillInput> = {}): AgentSkillInput =>
  ({ name: 'electron-testing', description: 'Testing Electron apps.', roles: ['QA'], content: '# Electron', ...overrides });

describe('AgentSkillsService', () => {
  const setup = () => {
    const userSkills = new StubUserSkillStore();
    const service = new AgentSkillsService(new AgentRegistryService(), userSkills, workspaceDirectoryAt('/ws'));
    return { userSkills, service };
  };

  it('should list only the skills whose roles name the role, matched case-insensitively', async () => {
    const { service, userSkills } = setup();
    userSkills.skills = [userSkill('cypress', ['qa', 'DEVELOPER'])];

    const qa = (await service.list('QA')).map(skill => skill.name);
    const developer = (await service.list('developer')).map(skill => skill.name);

    expect(qa).toEqual(['board-requests', 'running-the-app', 'web-ui-testing', 'api-testing', 'mobile-testing', 'cypress']);
    expect(developer).toEqual(['board-requests', 'asking-the-user', 'cypress']);
    expect((await service.list('CEO')).map(skill => skill.name)).toContain('artifact-board');
    expect(await service.list('UNKNOWN')).toEqual([]);
  });

  it('should build the content of a skill with the team of the reader and the workspaces root', async () => {
    const { service } = setup();

    const team = await service.read('CEO', 'agent-team');
    const delegation = await service.read('ceo', 'Delegation-Protocol');

    expect(team?.content).toContain('### QA — QA Agent');
    expect(team?.content).not.toContain('### CEO');
    expect(delegation?.content).toContain('`project="/ws/my-app"`');
  });

  it('should let a user skill replace a built-in one, roles included', async () => {
    const { service, userSkills } = setup();
    userSkills.skills = [userSkill('API-TESTING', ['DEVELOPER'], 'My way.')];

    expect((await service.list('QA')).map(skill => skill.name)).not.toContain('api-testing');
    expect(await service.read('QA', 'api-testing')).toBeUndefined();
    expect(await service.read('DEVELOPER', 'api-testing')).toEqual({ name: 'API-TESTING', description: 'API-TESTING skill.', content: 'My way.' });
  });

  it('should let a role that writes skills read and list every skill, and no other role', async () => {
    const { service, userSkills } = setup();
    userSkills.skills = [userSkill('cypress', ['QA'])];

    expect(await service.read('CEO', 'cypress')).toMatchObject({ content: 'Run it.' });
    expect(await service.read('QA', 'agent-team')).toBeUndefined();
    expect(service.writesSkills('QA')).toBe(false);
    expect(service.writesSkills('CEO')).toBe(true);
    const listing = await service.listAll();
    expect(listing).toContainEqual({ name: 'cypress', description: 'cypress skill.', roles: ['QA'], builtIn: false });
    expect(listing).toContainEqual(expect.objectContaining({ name: 'api-testing', roles: ['QA'], builtIn: true }));
  });

  it('should read any skill for a channel, built for the first role that reads it', async () => {
    const { service, userSkills } = setup();
    userSkills.skills = [userSkill('cypress', ['QA'])];

    expect(await service.readAny('Agent-Team')).toMatchObject({ name: 'agent-team', roles: ['CEO'], builtIn: true });
    expect((await service.readAny('agent-team'))?.content).not.toContain('### CEO');
    expect(await service.readAny('cypress')).toEqual({ name: 'cypress', description: 'cypress skill.', roles: ['QA'], builtIn: false, content: 'Run it.' });
    expect(await service.readAny('missing')).toBeUndefined();
  });

  it('should delete a user skill, bringing back the built-in one it replaced', async () => {
    const { service, userSkills } = setup();
    userSkills.skills = [userSkill('api-testing', ['DEVELOPER'])];

    expect(await service.deleteUserSkill('api-testing')).toBe(true);
    expect(await service.deleteUserSkill('api-testing')).toBe(false);
    expect((await service.list('QA')).map(skill => skill.name)).toContain('api-testing');
  });

  it('should write a skill for known roles, in their canonical form', async () => {
    const { service, userSkills } = setup();

    expect(await service.write('CEO', input({ roles: ['qa', 'Developer'] }))).toEqual({ ok: true, created: true });
    userSkills.skills = [userSkill('electron-testing', ['QA'])];
    expect(await service.write('CEO', input())).toEqual({ ok: true, created: false });
    expect(userSkills.written[0]?.roles).toEqual(['QA', 'DEVELOPER']);
  });

  it.each([
    ['QA', input(), 'You cannot write skills.'],
    ['CEO', input({ name: 'Electron Testing' }), 'Name the skill in lowercase kebab-case, up to 64 characters, as in electron-testing.'],
    ['CEO', input({ name: 'a'.repeat(65) }), 'Name the skill in lowercase kebab-case, up to 64 characters, as in electron-testing.'],
    ['CEO', input({ name: 'api-testing' }), '"api-testing" is a built-in skill and is not replaced from a conversation. Choose another name.'],
    ['CEO', input({ description: 'd'.repeat(1025) }), 'The description has 1025 characters; keep it within 1024.'],
    ['CEO', input({ content: 'c'.repeat(30_001) }), 'The content has 30001 characters; keep it within 30000, or split it into several skills.'],
    ['CEO', input({ roles: ['QA', 'TESTER', 'X'] }), 'Unknown role "TESTER", "X". The roles are: CEO, GIT_OPS, PRODUCT_OWNER, TECH_LEAD, DEVELOPER, CODE_REVIEWER, QA.'],
  ])('should refuse a skill written by %s: %s', async (role, skill, error) => {
    const { service, userSkills } = setup();

    expect(await service.write(role, skill)).toEqual({ ok: false, error });
    expect(userSkills.written).toEqual([]);
  });
});
