import { describe, expect, it } from '@rstest/core';

import { QA_ARTIFACT_ACCESS } from '../constants/artifact-access.constant.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';

import { buildArtifactProtocolBrief } from './artifact-protocol.prompt.js';
import { CWD_BOUNDARY_INSTRUCTIONS } from './cwd-boundary.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';
import { PROJECT_ORIENTATION_INSTRUCTIONS } from './project-orientation.prompt.js';
import { QA_REENTRY_NOTE, QA_SYSTEM_PROMPT } from './qa.prompt.js';


describe('qa.prompt', () => {
  describe('testing', () => {
    it('should test the task in practice and leave the review of the code to someone else', () => {
      expect(QA_SYSTEM_PROMPT).toContain('You are the QA Agent');
      expect(QA_SYSTEM_PROMPT).toContain('Reviewing the code is someone else\'s job; you judge behavior.');
    });

    it('should take the acceptance criteria and the test cases of the task as its test plan', () => {
      expect(QA_SYSTEM_PROMPT).toContain('Its acceptance criteria and test cases are your test plan');
    });

    it('should test the branch of the task without switching over uncommitted changes', () => {
      expect(QA_SYSTEM_PROMPT).toContain('switch to the task\'s branch');
      expect(QA_SYSTEM_PROMPT).toContain('When the working tree has uncommitted changes, do not switch');
    });

    it('should read the skills of the kind of application, with running-the-app among them', () => {
      expect(QA_SYSTEM_PROMPT).toContain('read the matching skills in your `[SKILLS]` list before you start');
      expect(QA_SYSTEM_PROMPT).toContain(`\`${SKILL_NAMES.runningTheApp}\` among them`);
    });

    it('should capture evidence of each test', () => {
      expect(QA_SYSTEM_PROMPT).toContain('capture evidence: the steps, the expected and the actual result');
    });
  });

  describe('environment', () => {
    it('should prepare its own test environment, changing data, configuration and code locally', () => {
      expect(QA_SYSTEM_PROMPT).toContain('### Preparing the Environment');
      expect(QA_SYSTEM_PROMPT).toContain('Setting up what the tests need is part of your task, so do it yourself');
      expect(QA_SYSTEM_PROMPT).toContain('insert or edit rows and documents in local databases');
    });

    it('should work only on local services and data', () => {
      expect(QA_SYSTEM_PROMPT).toContain('Work only on local services and data. A shared or production service is never the target of a test or of a change.');
    });
  });

  describe('boundaries', () => {
    it('should never commit, stage or push its changes, nor open a pull request', () => {
      expect(QA_SYSTEM_PROMPT).toContain('none of them is committed, staged or pushed, and you open no pull request');
    });

    it('should report a defect of the task as a finding and not fix it', () => {
      expect(QA_SYSTEM_PROMPT).toContain('A defect in what the task delivers is a finding for the developer, not something you fix.');
    });

    it('should leave the project as it found it before the final answer', () => {
      expect(QA_SYSTEM_PROMPT).toContain('revert your changes to tracked files, delete the files you created, stop every process you started');
      expect(QA_SYSTEM_PROMPT).toContain('`git status` shows what it showed when you started');
      expect(QA_SYSTEM_PROMPT).toContain('your final answer says what stayed');
    });
  });

  describe('verdict and report', () => {
    it('should answer PASSED, FAILED or BLOCKED and never count a criterion it could not verify as a pass', () => {
      expect(QA_SYSTEM_PROMPT).toContain('`PASSED`: every acceptance criterion and test case passed.');
      expect(QA_SYSTEM_PROMPT).toContain('`FAILED`: something the task delivers does not work');
      expect(QA_SYSTEM_PROMPT).toContain('`BLOCKED`: you could not test');
      expect(QA_SYSTEM_PROMPT).toContain('A criterion you could not verify is never a pass.');
    });

    it('should replace the test report of the task in the same response as the answer', () => {
      expect(QA_SYSTEM_PROMPT).toContain('<artifact_update id="T-3"><section name="test_report">Markdown</section></artifact_update>');
      expect(QA_SYSTEM_PROMPT).toContain('starting with the verdict on a line of its own');
      expect(QA_SYSTEM_PROMPT).toMatch(/starting with the verdict on a line of its own, written exactly as shown (here|above), in English whatever the language of the rest/);
    });
  });

  it('should include the board brief of its access and the shared blocks', () => {
    expect(QA_SYSTEM_PROMPT).toContain(buildArtifactProtocolBrief(QA_ARTIFACT_ACCESS));
    expect(QA_SYSTEM_PROMPT).toContain(PROJECT_ORIENTATION_INSTRUCTIONS);
    expect(QA_SYSTEM_PROMPT).toContain(CWD_BOUNDARY_INSTRUCTIONS);
    expect(QA_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
  });

  describe('re-entry note', () => {
    it('should send the tester back to its role guide', () => {
      expect(QA_REENTRY_NOTE.startsWith('[RE-ENTRY]')).toBe(true);
      expect(QA_REENTRY_NOTE).toContain('a session you started as the QA Agent');
      expect(QA_REENTRY_NOTE).toContain(`<skill_read name="${SKILL_NAMES.roleGuide}"/>`);
    });

    it('should carry the clean-up rule, the test report and the verdict words', () => {
      expect(QA_REENTRY_NOTE).toContain('nothing you change is committed or pushed, and the project is left as you found it');
      expect(QA_REENTRY_NOTE).toContain('Replace the `test_report` section');
      expect(QA_REENTRY_NOTE).toContain('written exactly as shown, in English: PASSED, FAILED or BLOCKED');
    });
  });
});
