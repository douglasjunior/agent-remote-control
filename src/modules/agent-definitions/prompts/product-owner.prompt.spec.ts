import { describe, expect, it } from 'vitest';

import { INTENT_DOCUMENTS_DIR } from '../constants/intent-documents.constant.js';

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
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('record it under "Divergences to fix"');
  });

  it('should keep open questions as a last resort and check the document before writing it', () => {
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('"Open questions" is a last resort');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('Every entry under "Open questions" has the user explicitly saying they do not know it');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('## Technical pending decisions');
  });

  it('should write only the intent document, in the temporary folder, and return its path', () => {
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain(`${INTENT_DOCUMENTS_DIR}/<YYYY-MM-DD-HHmm>-<short-slug>.md`);
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('the absolute path of the document');
    expect(PRODUCT_OWNER_TURN_REMINDER).toContain(`The only file you may write is the intent document, inside ${INTENT_DOCUMENTS_DIR}`);
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
