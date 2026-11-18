import { describe, expect, it } from '@rstest/core';

import { QA_ARTIFACT_ACCESS } from '../constants/artifact-access.constant.js';

import { buildArtifactProtocolBrief, buildArtifactProtocolReminder } from './artifact-protocol.prompt.js';
import { CWD_BOUNDARY_INSTRUCTIONS, CWD_BOUNDARY_REMINDER } from './cwd-boundary.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';
import { PROJECT_ORIENTATION_INSTRUCTIONS, PROJECT_ORIENTATION_REMINDER } from './project-orientation.prompt.js';
import { QA_SYSTEM_PROMPT, QA_TURN_REMINDER } from './qa.prompt.js';


describe('qa.prompt', () => {
  it('should test the task in practice from its branch, reading the skills of the kind of application', () => {
    expect(QA_SYSTEM_PROMPT).toContain('You are the QA Agent.');
    expect(QA_SYSTEM_PROMPT).toContain('Its acceptance criteria and test cases are your test plan');
    expect(QA_SYSTEM_PROMPT).toContain('When the working tree has uncommitted changes, do not switch');
    expect(QA_SYSTEM_PROMPT).toContain('read the matching skills before you start');
    expect(QA_TURN_REMINDER).toContain('<skill_read name="..."/>');
  });

  it('should prepare its own test environment, changing data, configuration and code locally', () => {
    expect(QA_SYSTEM_PROMPT).toContain('### Preparing the Environment');
    expect(QA_SYSTEM_PROMPT).toContain('Setting up what the tests need is part of your task, so do it yourself instead of returning it to the caller');
    expect(QA_SYSTEM_PROMPT).toContain('insert or edit rows and documents in local databases');
    expect(QA_SYSTEM_PROMPT).toContain('never point the application at, or change, a shared or production service');
    expect(QA_TURN_REMINDER).toContain('You prepare the environment you test in yourself');
  });

  it('should never commit or push its changes and leave the project as it found it', () => {
    expect(QA_SYSTEM_PROMPT).toContain('Never commit, stage, push or open pull requests, whatever you changed');
    expect(QA_SYSTEM_PROMPT).toContain('A defect in what the task delivers is a finding, never something you fix.');
    expect(QA_SYSTEM_PROMPT).toContain('`git status` must show what it showed when you started, so none of your changes reaches a commit');
    expect(QA_SYSTEM_PROMPT).toContain('your final answer says what stayed');
    expect(QA_TURN_REMINDER).toContain('Never commit, push or open pull requests with any of it');
    expect(QA_TURN_REMINDER).toContain('Leave the project as you found it: revert your changes to the project\'s files');
  });

  it('should record the test report and open the final answer with the verdict', () => {
    expect(QA_SYSTEM_PROMPT).toContain('replace the task\'s `test_report` section with');
    expect(QA_SYSTEM_PROMPT).toContain('A test you could not run is not a pass');
    expect(QA_TURN_REMINDER).toContain('your final answer starts with the verdict, PASSED or FAILED.');
    expect(QA_SYSTEM_PROMPT).toContain(buildArtifactProtocolBrief(QA_ARTIFACT_ACCESS));
    expect(QA_TURN_REMINDER).toContain(buildArtifactProtocolReminder(QA_ARTIFACT_ACCESS));
  });

  it('should include the shared orientation, boundaries and final response instructions', () => {
    expect(QA_SYSTEM_PROMPT).toContain(PROJECT_ORIENTATION_INSTRUCTIONS);
    expect(QA_SYSTEM_PROMPT).toContain(CWD_BOUNDARY_INSTRUCTIONS);
    expect(QA_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
    expect(QA_TURN_REMINDER).toContain(PROJECT_ORIENTATION_REMINDER);
    expect(QA_TURN_REMINDER).toContain(CWD_BOUNDARY_REMINDER);
    expect(QA_TURN_REMINDER).toContain('<final_response>...</final_response>');
  });
});
