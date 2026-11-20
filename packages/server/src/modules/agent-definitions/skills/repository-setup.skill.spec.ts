import { describe, expect, it } from '@rstest/core';

import { WORKSPACE_MANIFEST_FILE } from '../constants/workspace-manifest.constant.js';
import { skillContext } from '../testing/skill-context.fixture.js';

import { REPOSITORY_SETUP_SKILL } from './repository-setup.skill.js';


const WORKSPACE_DIR = '/home/user/workspaces';

describe('repository-setup skill', () => {
  const skill = REPOSITORY_SETUP_SKILL.buildContent(skillContext({ workspaceDir: WORKSPACE_DIR }));

  it('should be read by the Git ops agent only', () => {
    expect(REPOSITORY_SETUP_SKILL).toMatchObject({ name: 'repository-setup', roles: ['GIT_OPS'] });
    expect(REPOSITORY_SETUP_SKILL.description).toContain(WORKSPACE_MANIFEST_FILE);
  });

  it('should own the workspace manifest at the workspaces root as a URL to folder mapping', () => {
    expect(skill).toContain(`\`${WORKSPACE_DIR}/${WORKSPACE_MANIFEST_FILE}\` maps repository URLs to folder names`);
    expect(skill).toContain('You are its only writer');
    expect(skill).toContain('an absent file means an empty workspace');
    expect(skill).toContain('{ "url": "git@gitlab.com:group/my-app.git", "folder": "my-app", "defaultBranch": "main" }');
  });

  it('should report the folder of a repository already listed instead of cloning it again', () => {
    expect(skill).toContain('when the URL is already listed, the repository exists and you report its folder instead of cloning again');
  });

  it('should fix the folder naming rule so the same repository never lands twice', () => {
    expect(skill).toContain('the last path segment without the `.git` suffix');
    expect(skill).toContain('a different name creates a second clone of the same repository');
  });

  it('should choose the transport the instruction names, then the provider CLI over HTTPS, then SSH', () => {
    expect(skill).toContain('The transport the instruction names (HTTPS, SSH, a provider CLI) is the one to use.');
    expect(skill).toContain('clone over HTTPS with it: it needs no key setup');
    expect(skill).toContain('Otherwise use SSH');
    expect(skill).toContain('`git@github.com:<org>/<repo>.git`');
  });

  it('should not block an SSH clone on the confirmation of a host key', () => {
    expect(skill).toContain('GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new"');
  });

  it('should clone into the derived folder from the root and into the assigned folder from inside it', () => {
    expect(skill).toContain('clone into the derived folder name');
    expect(skill).toContain('`git clone <url> .`');
  });

  it('should generate a key only when none exists and never expose the private key', () => {
    expect(skill).toContain('ssh-keygen -t rsa -b 4096');
    expect(skill).toContain('ssh-keygen -y -f');
    expect(skill).toContain('An existing key is never overwritten, moved or deleted, and the private key (`$HOME/.ssh/id_rsa`) is never printed, copied or transmitted.');
  });

  it('should ask the user to register the public key and offer HTTPS through the provider CLI as the alternative', () => {
    expect(skill).toContain('put the full content of `$HOME/.ssh/id_rsa.pub` in a code block in your final answer');
    expect(skill).toContain('When HTTPS through the provider\'s CLI would work instead, say so as the alternative.');
  });

  it('should initialize a new repository with a single scaffolding commit and record it', () => {
    expect(skill).toContain('run `git init`, and make a single scaffolding commit in the Conventional Commits format');
    expect(skill).toContain('Record it in the manifest.');
  });
});
