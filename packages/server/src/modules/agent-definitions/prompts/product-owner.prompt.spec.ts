import { describe, expect, it } from '@rstest/core';

import { PRODUCT_OWNER_ARTIFACT_ACCESS } from '../constants/artifact-access.constant.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';

import { buildArtifactProtocolBrief } from './artifact-protocol.prompt.js';
import { CWD_BOUNDARY_INSTRUCTIONS } from './cwd-boundary.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';
import { buildProductOwnerReentryNote, buildProductOwnerSystemPrompt } from './product-owner.prompt.js';
import { PROJECT_ORIENTATION_INSTRUCTIONS } from './project-orientation.prompt.js';
import { USER_QUESTIONS_BRIEF } from './user-questions.prompt.js';


const PRODUCT_OWNER_SYSTEM_PROMPT = buildProductOwnerSystemPrompt('tags');
const PRODUCT_OWNER_REENTRY_NOTE = buildProductOwnerReentryNote('tags');

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

  it('should ask on invented rules, documentation conflicts and divergences between system and documentation', () => {
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('**No invented business rule.**');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('**Conflict with existing documentation.**');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('record it in `pending_decisions` as a divergence to fix');
  });

  it('should keep the board and the files apart', () => {
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('**Read-only on files.** Everything you write goes to the board through artifact requests');
  });

  it('should keep open questions as a last resort and check the board before writing to it', () => {
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('"Open questions" is a last resort');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('Every entry in `open_questions` has the user explicitly saying they do not know it');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('### Before Writing to the Board');
  });

  it('should consolidate the intent as a feature and its tasks on the board', () => {
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('The initiative becomes one feature in the project it concerns, and the feature is broken into tasks');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('- `acceptance_criteria`: observable behavior');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('Set `business_refinement="done"`');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain('the ids of the artifacts you created or changed');
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain(buildArtifactProtocolBrief(PRODUCT_OWNER_ARTIFACT_ACCESS, 'tags'));
  });

  it('should include the shared orientation, boundaries, question and final response instructions', () => {
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain(PROJECT_ORIENTATION_INSTRUCTIONS);
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain(CWD_BOUNDARY_INSTRUCTIONS);
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain(USER_QUESTIONS_BRIEF);
    expect(PRODUCT_OWNER_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
  });

  describe('re-entry note', () => {
    it('should send the product owner back to its role guide', () => {
      expect(PRODUCT_OWNER_REENTRY_NOTE.startsWith('[RE-ENTRY]')).toBe(true);
      expect(PRODUCT_OWNER_REENTRY_NOTE).toContain('a session you started as the Product Owner Agent');
      expect(PRODUCT_OWNER_REENTRY_NOTE).toContain(`<skill_read name="${SKILL_NAMES.roleGuide}"/>`);
    });

    it('should carry the interview rule, the technical boundary and the deliverable', () => {
      expect(PRODUCT_OWNER_REENTRY_NOTE).toContain('every question is a `<question>` tag');
      expect(PRODUCT_OWNER_REENTRY_NOTE).toContain('recorded in `pending_decisions`, neither asked nor decided');
      expect(PRODUCT_OWNER_REENTRY_NOTE).toContain('`business_refinement="done"`');
    });
  });

  describe('on the tools interface', () => {
    const prompt = buildProductOwnerSystemPrompt('tools');
    const note = buildProductOwnerReentryNote('tools');

    it('should keep every passage that does not depend on the interface', () => {
      expect(prompt).toContain('### Hunt for What Was Not Said');
      expect(prompt).toContain('### Before Writing to the Board');
      expect(prompt).toContain(buildArtifactProtocolBrief(PRODUCT_OWNER_ARTIFACT_ACCESS, 'tools'));
      expect(prompt).toContain(USER_QUESTIONS_BRIEF);
    });

    it('should write to the board through its tools, creating the feature before its tasks', () => {
      expect(prompt).toContain('Everything you write goes to the board through its tools.');
      expect(prompt).toContain('Create the feature before its tasks: a creation returns the new id, for the `parent` and `depends_on` of the next ones.');
      expect(prompt).not.toContain('artifact requests');
      expect(prompt).not.toContain('<artifact_');
    });

    it('should keep the interview rules in the re-entry note and name the tools', () => {
      expect(note).toContain('every question is a `<question>` tag');
      expect(note).toContain('the tools of the `arc` MCP server');
    });
  });
});
