import { describe, expect, it } from '@rstest/core';

import { GIT_OPS_ARTIFACT_ACCESS } from '../constants/artifact-access.constant.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';

import { buildArtifactProtocolBrief } from './artifact-protocol.prompt.js';
import { CWD_BOUNDARY_INSTRUCTIONS } from './cwd-boundary.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';
import { GIT_OPS_REENTRY_NOTE, GIT_OPS_SYSTEM_PROMPT } from './git-ops.prompt.js';


describe('git-ops.prompt', () => {
  describe('scope', () => {
    it('should define the agent as the owner of repository administration and not of application code', () => {
      expect(GIT_OPS_SYSTEM_PROMPT).toContain('You are the Git Ops Agent');
      expect(GIT_OPS_SYSTEM_PROMPT).toContain('You write no application code and run no project test suite');
      expect(GIT_OPS_SYSTEM_PROMPT).toContain('the developer commits, pushes and opens the pull request of its own task');
    });

    it('should send the agent to the repository-setup and git-remote skills for the procedures', () => {
      expect(GIT_OPS_SYSTEM_PROMPT).toContain(`The \`${SKILL_NAMES.repositorySetup}\` skill has the procedure, the workspace manifest and the SSH key setup`);
      expect(GIT_OPS_SYSTEM_PROMPT).toContain(`The \`${SKILL_NAMES.gitRemote}\` skill has the provider tooling`);
    });

    it('should follow the transport the caller asks for', () => {
      expect(GIT_OPS_SYSTEM_PROMPT).toContain('An instruction that names HTTPS, SSH or a provider CLI is the user\'s choice for that repository and overrides your default.');
    });

    it('should describe both working directories it can be given', () => {
      expect(GIT_OPS_SYSTEM_PROMPT).toContain('the workspaces root, a container where each direct subfolder is one repository');
      expect(GIT_OPS_SYSTEM_PROMPT).toContain('a single project folder');
    });
  });

  describe('destructive operations', () => {
    it('should run them only on an explicit instruction naming the operation and its target', () => {
      expect(GIT_OPS_SYSTEM_PROMPT).toContain('run only on an explicit instruction from the caller that names the operation and its target');
      expect(GIT_OPS_SYSTEM_PROMPT).toContain('A rejected push, a failed merge or a faster path is not an instruction.');
    });

    it('should use the narrowest form and report what was destroyed', () => {
      expect(GIT_OPS_SYSTEM_PROMPT).toContain('--force-with-lease');
      expect(GIT_OPS_SYSTEM_PROMPT).toContain('never `--all`, `--mirror` or wildcard refspecs');
      expect(GIT_OPS_SYSTEM_PROMPT).toContain('Report what was destroyed: the ref and its old and new commit hashes.');
    });
  });

  describe('boundaries', () => {
    it('should confine the agent to its CWD except for the SSH key setup of the repository-setup skill', () => {
      expect(GIT_OPS_SYSTEM_PROMPT).toContain(CWD_BOUNDARY_INSTRUCTIONS);
      expect(GIT_OPS_SYSTEM_PROMPT).toContain(`\`$HOME/.ssh\` is authorized for the steps of the \`${SKILL_NAMES.repositorySetup}\` skill without a request`);
    });

    it('should bring the decisions the user must make back to the caller instead of asking', () => {
      expect(GIT_OPS_SYSTEM_PROMPT).not.toContain('<question');
      expect(GIT_OPS_SYSTEM_PROMPT).toContain('You never ask the user');
      expect(GIT_OPS_SYSTEM_PROMPT).toContain('name it in your final answer for the caller to decide with the user');
    });
  });

  describe('working on a task', () => {
    it('should merge the pull request of a task into its target branch, the default one only with the approval of the user', () => {
      expect(GIT_OPS_SYSTEM_PROMPT).toContain('merge it into the branch it targets');
      expect(GIT_OPS_SYSTEM_PROMPT).toContain('so do it only when the instruction says the user approved it');
    });

    it('should record the merged or closed pull request on the task in the same response as the answer', () => {
      expect(GIT_OPS_SYSTEM_PROMPT).toContain('<artifact_update id="T-3"><pull_request url="https://..." title="T-3: Login API" state="merged"/></artifact_update>');
    });
  });

  it('should report the project folder, the branch and the exact Git error', () => {
    expect(GIT_OPS_SYSTEM_PROMPT).toContain('State the project folder (the caller routes later work by that name), the current branch and what changed on the remote.');
    expect(GIT_OPS_SYSTEM_PROMPT).toContain('give the exact Git error rather than a summary');
  });

  it('should include the board brief of its access and the final response instructions', () => {
    expect(GIT_OPS_SYSTEM_PROMPT).toContain(buildArtifactProtocolBrief(GIT_OPS_ARTIFACT_ACCESS));
    expect(GIT_OPS_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
  });

  describe('re-entry note', () => {
    it('should send the agent back to its role guide', () => {
      expect(GIT_OPS_REENTRY_NOTE.startsWith('[RE-ENTRY]')).toBe(true);
      expect(GIT_OPS_REENTRY_NOTE).toContain('a session you started as the Git Ops Agent');
      expect(GIT_OPS_REENTRY_NOTE).toContain(`<skill_read name="${SKILL_NAMES.roleGuide}"/>`);
    });

    it('should carry the destructive operation rule and the report', () => {
      expect(GIT_OPS_REENTRY_NOTE).toContain('A destructive operation (force push, deleting a remote ref, discarding work) runs only on an instruction that names it and its target');
      expect(GIT_OPS_REENTRY_NOTE).toContain('the exact Git error when something failed');
    });
  });
});
