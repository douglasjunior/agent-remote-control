import { describe, expect, it } from 'vitest';

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

  it('should never change the project and leave it as it found it', () => {
    expect(QA_SYSTEM_PROMPT).toContain('Never change the project\'s code, configuration, tests or dependencies manifest, and never commit');
    expect(QA_SYSTEM_PROMPT).toContain('`git status` must show what it showed when you started');
    expect(QA_TURN_REMINDER).toContain('Leave the project as you found it');
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
    expect(QA_TURN_REMINDER).toContain('<final_response>');
  });
});
