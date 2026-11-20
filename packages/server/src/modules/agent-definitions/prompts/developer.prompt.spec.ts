import { describe, expect, it } from '@rstest/core';

import { DEVELOPER_ARTIFACT_ACCESS } from '../constants/artifact-access.constant.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';

import { buildArtifactProtocolBrief } from './artifact-protocol.prompt.js';
import { CWD_BOUNDARY_INSTRUCTIONS } from './cwd-boundary.prompt.js';
import { DEVELOPER_REENTRY_NOTE, DEVELOPER_SYSTEM_PROMPT } from './developer.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';
import { PROJECT_ORIENTATION_INSTRUCTIONS } from './project-orientation.prompt.js';


describe('developer.prompt', () => {
  it('should define the developer as the agent that takes one task to work ready for review', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('You are the Developer Agent');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('The task opens your prompt in a `[DELEGATED_ARTIFACT]` block');
  });

  it('should make the notes it records part of the deliverable for the reviewer and the tester', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('a reviewer with no memory of this session judges the branch against the task, and a tester runs it');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('those notes are part of the deliverable');
  });

  it('should fix the findings of the review or the test report when the task comes back', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('fix the findings in its `review_findings` or `test_report` section');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('append what you fixed and how (`mode="append"`)');
  });

  it('should run the checks of the project and wait for them before it finishes', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Run the checks the project defines');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Work whose checks you did not see pass is not done.');
  });

  it('should use the commands the project documents for itself', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Use the commands the project documents for itself');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('rather than reproducing their steps');
  });

  it('should bring the decisions the user must make back to the caller instead of asking', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).not.toContain('<question');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('You do not ask the user yourself');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('put the conflict and its options in your final answer');
  });

  describe('git', () => {
    it('should work on the branch of the task, naming a new one after the project convention', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('Work on the branch of the task');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('`<type>/<task id>-<short-slug>`');
    });

    it('should commit in atomic commits that follow the project convention, keeping secrets out', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('atomic commits that follow the project\'s commit convention');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('Conventional Commits in English');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('keep credentials, keys and `.env` files out of commits');
    });

    it('should push the branch and open or update the pull request through the git-remote skill', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('push the branch of the task and open its pull request, or update the one already linked on the task');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain(`The \`${SKILL_NAMES.gitRemote}\` skill has the procedure`);
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('Without a remote the branch stays local');
    });

    it('should change no branch but its own and leave the rest to another agent without naming it', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('The branch of the task is the only one you change.');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('force pushes, deleting remote refs, cloning and remote configuration belong to another agent');
      expect(DEVELOPER_SYSTEM_PROMPT).not.toContain('GIT_OPS');
      expect(DEVELOPER_SYSTEM_PROMPT).not.toContain('ssh-keygen');
    });
  });

  describe('verdict', () => {
    it('should record the branch, the notes and the pull request on the task together with the answer', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('<artifact_update id="T-3" branch="feat/t-3-login-api"><section name="implementation_notes">Markdown</section><pull_request url="https://..." title="T-3: Login API" state="open"/></artifact_update>');
    });

    it('should keep the verdict DONE when only the pull request cannot be opened', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('A pull request that cannot be opened (no hosting provider, no tooling for it) does not make the work incomplete');
    });

    it('should start the answer with DONE or INCOMPLETE on a line of its own', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('starting with the verdict on a line of its own');
      expect(DEVELOPER_SYSTEM_PROMPT).toMatch(/starting with the verdict on a line of its own, written exactly as shown (here|above), in English whatever the language of the rest/);
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('`DONE`: everything the task asks is committed, pushed when there is a remote, and its checks passed.');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('`INCOMPLETE`: anything else.');
    });

    it('should keep the answer short because the details are on the task', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('The details are in the notes, so do not repeat them.');
    });
  });

  it('should include the board brief of its access and the shared blocks', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain(buildArtifactProtocolBrief(DEVELOPER_ARTIFACT_ACCESS));
    expect(DEVELOPER_SYSTEM_PROMPT).toContain(PROJECT_ORIENTATION_INSTRUCTIONS);
    expect(DEVELOPER_SYSTEM_PROMPT).toContain(CWD_BOUNDARY_INSTRUCTIONS);
    expect(DEVELOPER_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
  });

  describe('re-entry note', () => {
    it('should send the developer back to its role guide', () => {
      expect(DEVELOPER_REENTRY_NOTE.startsWith('[RE-ENTRY]')).toBe(true);
      expect(DEVELOPER_REENTRY_NOTE).toContain('a session you started as the Developer Agent');
      expect(DEVELOPER_REENTRY_NOTE).toContain(`<skill_read name="${SKILL_NAMES.roleGuide}"/>`);
    });

    it('should carry the checks, the push and the record with the verdict words', () => {
      expect(DEVELOPER_REENTRY_NOTE).toContain('run the project\'s checks and wait for them, then push and update its pull request');
      expect(DEVELOPER_REENTRY_NOTE).toContain('Record the branch, the pull request and the implementation notes on the task');
      expect(DEVELOPER_REENTRY_NOTE).toContain('written exactly as shown, in English: DONE or INCOMPLETE');
    });
  });
});
