import { describe, expect, it } from 'vitest';

import { CODE_REVIEWER_ARTIFACT_ACCESS } from '../constants/artifact-access.constant.js';

import { buildArtifactProtocolInstructions, buildArtifactProtocolReminder } from './artifact-protocol.prompt.js';
import { CODE_REVIEWER_SYSTEM_PROMPT, CODE_REVIEWER_TURN_REMINDER } from './code-reviewer.prompt.js';
import { CWD_BOUNDARY_INSTRUCTIONS, CWD_BOUNDARY_REMINDER } from './cwd-boundary.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';
import { PROJECT_ORIENTATION_INSTRUCTIONS, PROJECT_ORIENTATION_REMINDER } from './project-orientation.prompt.js';


describe('code-reviewer.prompt', () => {
  it('should review the open pull request of the task it holds, or its branch locally without one', () => {
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Code Reviewer Agent');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('**Pull request review**: when the task links an open pull request');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('**Local review**: when the task links no open pull request, review its branch locally against its base');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('`git diff <base>...<branch>`');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('never check out, commit, merge, reset or change branches');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('do they deliver the acceptance criteria and the technical solution');
  });

  it('should never run the project and rely on the pipeline, stating a local review ran nothing', () => {
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Do NOT run the project, its tests, builds, linters, or any command that executes project code');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('read the status and results of its checks');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('A local review has no pipeline: state in your verdict that nothing was run.');
    expect(CODE_REVIEWER_TURN_REMINDER).toContain('Never run the project, its tests, builds or linters');
  });

  it('should prohibit inventing problems', () => {
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Do NOT invent problems');
  });

  it('should always record the findings on the task and publish them on the pull request when there is one', () => {
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('replace the task\'s `review_findings` section with: the verdict');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('In a pull request review, also publish every finding on the pull request, without asking');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('`side: RIGHT` / `new_line` / `rightFileStart`');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('MCP (Model Context Protocol)');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('No Fallback');
    expect(CODE_REVIEWER_TURN_REMINDER).toContain('MCP -> Official CLI -> No Fallback');
    expect(CODE_REVIEWER_TURN_REMINDER).toContain('Record the verdict and the findings in the task\'s `review_findings` section');
  });

  it('should open the final answer with the verdict', () => {
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('APPROVED: no high or medium finding and no failing check');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain('Your final answer starts with the verdict');
    expect(CODE_REVIEWER_TURN_REMINDER).toContain('Your final answer starts with the verdict, APPROVED or CHANGES_REQUESTED.');
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain(buildArtifactProtocolInstructions(CODE_REVIEWER_ARTIFACT_ACCESS));
    expect(CODE_REVIEWER_TURN_REMINDER).toContain(buildArtifactProtocolReminder(CODE_REVIEWER_ARTIFACT_ACCESS));
  });

  it('should include the shared orientation, boundaries and final response instructions', () => {
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain(PROJECT_ORIENTATION_INSTRUCTIONS);
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain(CWD_BOUNDARY_INSTRUCTIONS);
    expect(CODE_REVIEWER_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
    expect(CODE_REVIEWER_TURN_REMINDER).toContain(PROJECT_ORIENTATION_REMINDER);
    expect(CODE_REVIEWER_TURN_REMINDER).toContain(CWD_BOUNDARY_REMINDER);
    expect(CODE_REVIEWER_TURN_REMINDER).toContain('<final_response>');
  });
});
