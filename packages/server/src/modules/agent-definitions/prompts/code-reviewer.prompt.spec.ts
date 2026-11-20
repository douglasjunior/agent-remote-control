import { describe, expect, it } from '@rstest/core';

import { CODE_REVIEWER_ARTIFACT_ACCESS } from '../constants/artifact-access.constant.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';

import { buildArtifactProtocolBrief } from './artifact-protocol.prompt.js';
import { CODE_REVIEWER_REENTRY_NOTE, CODE_REVIEWER_SYSTEM_PROMPT } from './code-reviewer.prompt.js';
import { CWD_BOUNDARY_INSTRUCTIONS } from './cwd-boundary.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';
import { PROJECT_ORIENTATION_INSTRUCTIONS } from './project-orientation.prompt.js';


describe('code-reviewer.prompt', () => {
  describe('what it reviews', () => {
    it('should review the open pull request of the task it holds', () => {
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('You are the Code Reviewer Agent');
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('**Pull request review**: when the task links an open pull request');
    });

    it('should review the branch locally against its base when the task links no open pull request', () => {
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('**Local review**: when the task links no open pull request, review its branch against its base');
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('`git diff <base>...<branch>`');
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('you do not check out, commit, merge, reset or switch branches');
    });

    it('should judge the change against the task and the conventions of the project', () => {
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('does it deliver the acceptance criteria and the technical solution');
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('the project\'s conventions');
    });

    it('should check each earlier finding when it comes back to a task it already reviewed', () => {
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('check each earlier finding against the new commits');
    });
  });

  describe('the pipeline', () => {
    it('should never run the project and rely on the checks of the pipeline', () => {
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('You do not run the project, its tests, builds or linters');
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('read the status and the results of its checks');
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('A failing check is a finding');
    });

    it('should state in the verdict that a local review ran nothing', () => {
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('A local review has no pipeline: state in your verdict that nothing was run.');
    });
  });

  describe('findings', () => {
    it('should report only real problems the change introduces and never invent one', () => {
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Real, verifiable problems the change introduces');
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('a review that invents problems costs a full round of rework');
    });

    it('should leave cosmetic matters out of the findings', () => {
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Not findings: cosmetic refactorings, naming debates');
    });

    it('should give each finding its file, line, severity, problem, impact and fix', () => {
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('the severity (high, medium or low)');
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('a suggested fix');
    });

    it('should check a security baseline on every change', () => {
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Security baseline to check on every change');
    });
  });

  describe('verdict and record', () => {
    it('should approve only without a high or medium finding and without a failing check', () => {
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('`APPROVED`: no high or medium finding and no failing check.');
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('`CHANGES_REQUESTED`: anything that must change');
    });

    it('should replace the review findings of the task in the same response as the answer', () => {
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('<artifact_update id="T-3"><section name="review_findings">Markdown</section></artifact_update>');
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('starting with the verdict on a line of its own');
    });

    it('should publish the findings on the pull request through the review-publishing skill', () => {
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('also publish every finding on the pull request and submit the review with your verdict, without asking');
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain(`The \`${SKILL_NAMES.reviewPublishing}\` skill has the procedure`);
    });

    it('should modify no file, create no commit and push nothing', () => {
      expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('You modify no file, create no commit and push nothing.');
    });
  });

  it('should include the board brief of its access and the shared blocks', () => {
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain(buildArtifactProtocolBrief(CODE_REVIEWER_ARTIFACT_ACCESS));
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain(PROJECT_ORIENTATION_INSTRUCTIONS);
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain(CWD_BOUNDARY_INSTRUCTIONS);
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
  });

  describe('re-entry note', () => {
    it('should send the reviewer back to its role guide', () => {
      expect(CODE_REVIEWER_REENTRY_NOTE.startsWith('[RE-ENTRY]')).toBe(true);
      expect(CODE_REVIEWER_REENTRY_NOTE).toContain('a session you started as the Code Reviewer Agent');
      expect(CODE_REVIEWER_REENTRY_NOTE).toContain(`<skill_read name="${SKILL_NAMES.roleGuide}"/>`);
    });

    it('should carry the read-only rule, the findings record and the verdict words', () => {
      expect(CODE_REVIEWER_REENTRY_NOTE).toContain('without running the project and without changing any file');
      expect(CODE_REVIEWER_REENTRY_NOTE).toContain('Replace the `review_findings` section');
      expect(CODE_REVIEWER_REENTRY_NOTE).toContain('APPROVED or CHANGES_REQUESTED');
    });
  });
});
