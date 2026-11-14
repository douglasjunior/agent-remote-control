import { describe, expect, it } from 'vitest';

import { skillContext } from '../testing/skill-context.fixture.js';

import { WORKSPACE_NAVIGATION_SKILL } from './workspace-navigation.skill.js';


const WORKSPACE_DIR = '/home/user/workspaces';

describe('workspace-navigation skill', () => {
  const skill = WORKSPACE_NAVIGATION_SKILL.buildContent(skillContext({ workspaceDir: WORKSPACE_DIR }));

  it('should be read by the CEO only', () => {
    expect(WORKSPACE_NAVIGATION_SKILL).toMatchObject({ name: 'workspace-navigation', roles: ['CEO'] });
  });

  it('should let the CEO read the manifest but never write it', () => {
    expect(skill).toContain('workspace-manifest.json');
    expect(skill).toContain('Read it to answer whether a repository is already in the workspace');
    expect(skill).toContain('Never write it.');
  });

  it('should make the listing the source of truth for delegations and artifacts', () => {
    expect(skill).toContain('Project folders are the direct, non-hidden subfolders');
    expect(skill).toContain('that listing is the source of truth for delegation and for the project of every artifact');
    expect(skill).not.toContain('AGENTS.md');
  });

  it('should match repository URLs regardless of protocol form', () => {
    expect(skill).toContain('`https://host/group/repo` and `git@host:group/repo` are the same repository');
  });
});
