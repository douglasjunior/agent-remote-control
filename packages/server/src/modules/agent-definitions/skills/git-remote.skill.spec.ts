import { describe, expect, it } from '@rstest/core';

import { skillContext } from '../testing/skill-context.fixture.js';

import { GIT_REMOTE_SKILL } from './git-remote.skill.js';


describe('git-remote skill', () => {
  const skill = GIT_REMOTE_SKILL.buildContent(skillContext());

  it('should be read by the roles that push and merge', () => {
    expect(GIT_REMOTE_SKILL).toMatchObject({ name: 'git-remote', roles: ['DEVELOPER', 'GIT_OPS'] });
  });

  it('should prefer the provider MCP tools, then its CLI, and never raw REST calls', () => {
    expect(skill).toContain('the provider\'s MCP tools when your session has them; otherwise its official CLI');
    expect(skill).toContain('do not fall back to `curl`, raw REST calls or ad-hoc scripts');
  });

  it('should leave a branch local when the repository has no remote', () => {
    expect(skill).toContain('A repository without a remote has nothing to push: the branch stays local');
  });

  it('should push only the given branch and report a rejection without forcing it', () => {
    expect(skill).toContain('Push only the branch you were given: `git push -u origin <branch>`');
    expect(skill).toContain('forcing it is a destructive operation that needs an explicit instruction naming it');
  });

  it('should report an authentication failure and the transport instead of working around it', () => {
    expect(skill).toContain('is not yours to work around: report the exact error and the transport the remote uses');
  });

  it('should open one pull request per repository the task changes and update the linked one by pushing', () => {
    expect(skill).toContain('One pull request per repository the task changes, each from the branch of the task, which has the same name in every repository.');
    expect(skill).toContain('pushing the branch updates it: do not open another');
  });

  it('should record each pull request on the task with its repository', () => {
    expect(skill).toContain('Record each on the task with its `repository`, the path of the repository inside your project folder (`.` for the folder itself)');
    expect(skill).toContain('<pull_request url="https://..." title="T-3: Login API" state="open" repository="repositories/api"/>');
  });

  it('should merge only on an instruction, stopping on running or failing checks and conflicts, and record the merge', () => {
    expect(skill).toContain('Merge only on an instruction to merge that pull request');
    expect(skill).toContain('Checks still running or failing, or a merge conflict, stop the merge');
    expect(skill).toContain('`state="merged"`');
  });

  describe('on the tools interface', () => {
    it('should record the pull request in the pull_requests of artifact_update', () => {
      const tools = GIT_REMOTE_SKILL.buildContent(skillContext({ agentInterface: 'tools' }));

      expect(tools).toContain('- Record each on the task with its `repository`, the path of the repository inside your project folder (`.` for the folder itself): its URL, title, repository and state `open` in the `pull_requests` of an `artifact_update` of the task.');
      expect(tools).not.toContain('<pull_request');
      expect(tools).not.toContain('<artifact_');
    });
  });
});
