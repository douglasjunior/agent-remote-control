import { describe, expect, it } from 'vitest';

import { CWD_BOUNDARY_INSTRUCTIONS, CWD_BOUNDARY_REMINDER } from './cwd-boundary.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';
import { GIT_OPS_SYSTEM_PROMPT, GIT_OPS_TURN_REMINDER } from './git-ops.prompt.js';
import { USER_QUESTIONS_INSTRUCTIONS, USER_QUESTIONS_REMINDER } from './user-questions.prompt.js';


describe('git-ops.prompt', () => {
  it('should confine the agent to its CWD except for its own SSH key setup', () => {
    expect(GIT_OPS_SYSTEM_PROMPT).toContain(CWD_BOUNDARY_INSTRUCTIONS);
    expect(GIT_OPS_SYSTEM_PROMPT).toContain('$HOME/.ssh is authorized for the steps in SSH Key Setup');
    expect(GIT_OPS_TURN_REMINDER).toContain(CWD_BOUNDARY_REMINDER);
  });

  it('should define the agent as the owner of remote Git operations', () => {
    expect(GIT_OPS_SYSTEM_PROMPT).toContain('You are the Git Ops Agent.');
    expect(GIT_OPS_SYSTEM_PROMPT).toContain('every Git operation that reaches a remote');
  });

  it('should leave staging, committing, and local branches to the implementing agent', () => {
    expect(GIT_OPS_SYSTEM_PROMPT).toContain(
      'staging, committing, local branch creation, and inspection of a working tree belong to the agent doing the implementation',
    );
  });

  it('should forbid force push', () => {
    expect(GIT_OPS_SYSTEM_PROMPT).toContain('Never force push');
  });

  it('should describe both working directories it can be given', () => {
    expect(GIT_OPS_SYSTEM_PROMPT).toContain('The workspaces root');
    expect(GIT_OPS_SYSTEM_PROMPT).toContain('A single project folder');
  });

  it('should own the workspace manifest as a URL to folder mapping', () => {
    expect(GIT_OPS_SYSTEM_PROMPT).toContain('workspace-manifest.json');
    expect(GIT_OPS_SYSTEM_PROMPT).toContain('You are its only writer');
    expect(GIT_OPS_SYSTEM_PROMPT).toContain('an absent file means an empty workspace');
  });

  it('should fix the folder naming rule so the same repository never lands twice', () => {
    expect(GIT_OPS_SYSTEM_PROMPT).toContain('take the last path segment and drop the `.git` suffix');
    expect(GIT_OPS_SYSTEM_PROMPT).toContain('a different name creates a duplicate clone of the same repository');
  });

  it('should require SSH clone URLs and non-blocking host key acceptance', () => {
    expect(GIT_OPS_SYSTEM_PROMPT).toContain('Always use the SSH URL form, never HTTPS');
    expect(GIT_OPS_SYSTEM_PROMPT).toContain('StrictHostKeyChecking=accept-new');
  });

  it('should carry the SSH key setup and never expose the private key', () => {
    expect(GIT_OPS_SYSTEM_PROMPT).toContain('ssh-keygen -t rsa -b 4096');
    expect(GIT_OPS_SYSTEM_PROMPT).toContain('Never print, copy, or transmit the private key');
  });

  it('should require the final answer inside the final response block', () => {
    expect(GIT_OPS_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
  });

  it('should remind the agent to report the project folder it used', () => {
    expect(GIT_OPS_TURN_REMINDER).toContain('Report the project folder name');
    expect(GIT_OPS_TURN_REMINDER).toContain('<final_response>');
  });

  it('should explain to the git ops agent how to ask the user, in the prompt and in every turn', () => {
    expect(GIT_OPS_SYSTEM_PROMPT).toContain(USER_QUESTIONS_INSTRUCTIONS);
    expect(GIT_OPS_TURN_REMINDER).toContain(USER_QUESTIONS_REMINDER);
  });
});
