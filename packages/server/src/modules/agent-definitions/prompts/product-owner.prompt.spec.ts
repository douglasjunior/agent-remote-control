import { describe, expect, it } from 'vitest';

import { PRODUCT_OWNER_ARTIFACT_ACCESS } from '../constants/artifact-access.constant.js';

import { buildArtifactProtocolInstructions, buildArtifactProtocolReminder } from './artifact-protocol.prompt.js';
import { CWD_BOUNDARY_INSTRUCTIONS, CWD_BOUNDARY_REMINDER } from './cwd-boundary.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';
import { PRODUCT_OWNER_SYSTEM_PROMPT, PRODUCT_OWNER_TURN_REMINDER } from './product-owner.prompt.js';
import { PROJECT_ORIENTATION_INSTRUCTIONS, PROJECT_ORIENTATION_REMINDER } from './project-orientation.prompt.js';
import { USER_QUESTIONS_INSTRUCTIONS, USER_QUESTIONS_REMINDER } from './user-questions.prompt.js';


describe('product-owner.prompt', () => {
  it('should extract the intent from a non-technical user without solving or estimating it', () => {
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('Assume they are not technical');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('The user is the source of truth about the business');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('Do not estimate effort, do not judge technical feasibility, and do not choose technology');
  });

  it('should hunt for what was not said, including usability and success measures', () => {
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('who approves it, and who is notified');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('interrupted halfway');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('applies retroactively');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('empty states, waiting, errors');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('How success will be measured');
  });

  it('should forbid technical jargon in what it writes while reading the code freely', () => {
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('no file, class, table, column, endpoint, framework, library, or code-pattern names');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('What the code shows is current behavior, not a business rule');
  });

  it('should record technical decisions instead of asking or deciding them', () => {
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('You neither ask the user about them nor decide them');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('The single exception is a technical choice that changes the behavior the end user sees');
  });

  it('should block on invented rules, documentation conflicts, and divergences between system and documentation', () => {
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('Never invent a business rule');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('Conflict with existing documentation');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('record it in `pending_decisions` as a divergence to fix');
  });

  it('should keep open questions as a last resort and check the board before writing to it', () => {
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('"Open questions" is a last resort');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('Every entry in `open_questions` has the user explicitly saying they do not know it');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('### Before Writing to the Board');
  });

  it('should consolidate the intent as a feature and its tasks on the board, not as a file', () => {
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('The initiative becomes one feature in the project it concerns, and the feature is broken into tasks');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('- `acceptance_criteria`: observable behavior');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('Set `business_refinement="done"`');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('Everything you write goes to the board through artifact requests');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('the ids of the artifacts you created or changed');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain(buildArtifactProtocolInstructions(PRODUCT_OWNER_ARTIFACT_ACCESS));
    expect(PRODUCT_OWNER_TURN_REMINDER).toContain(buildArtifactProtocolReminder(PRODUCT_OWNER_ARTIFACT_ACCESS));
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).not.toContain('intent.md');
  });

  it('should include the shared orientation, boundaries, question, and final response instructions', () => {
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain(PROJECT_ORIENTATION_INSTRUCTIONS);
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain(CWD_BOUNDARY_INSTRUCTIONS);
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain(USER_QUESTIONS_INSTRUCTIONS);
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
    expect(PRODUCT_OWNER_TURN_REMINDER).toContain(PROJECT_ORIENTATION_REMINDER);
    expect(PRODUCT_OWNER_TURN_REMINDER).toContain(CWD_BOUNDARY_REMINDER);
    expect(PRODUCT_OWNER_TURN_REMINDER).toContain(USER_QUESTIONS_REMINDER);
    expect(PRODUCT_OWNER_TURN_REMINDER).toContain('<final_response>');
  });
});
