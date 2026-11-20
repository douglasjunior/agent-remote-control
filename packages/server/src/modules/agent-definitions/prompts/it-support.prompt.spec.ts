import { describe, expect, it } from '@rstest/core';

import { SKILL_NAMES } from '../constants/skill-names.constant.js';

import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';
import { IT_SUPPORT_REENTRY_NOTE, IT_SUPPORT_SYSTEM_PROMPT } from './it-support.prompt.js';
import { USER_QUESTIONS_BRIEF } from './user-questions.prompt.js';


describe('it-support.prompt', () => {
  it('should investigate read-only before asking the user to approve a plan', () => {
    expect(IT_SUPPORT_SYSTEM_PROMPT).toContain('You are the IT Support Agent');
    expect(IT_SUPPORT_SYSTEM_PROMPT).toContain('### Step 1: Investigate (read-only)');
    expect(IT_SUPPORT_SYSTEM_PROMPT).toContain('change nothing until the answer arrives');
    expect(IT_SUPPORT_SYSTEM_PROMPT).toContain('Each step says what will happen and why it is needed');
  });

  it('should stay inside the approved plan and protect the user\'s data and secrets', () => {
    expect(IT_SUPPORT_SYSTEM_PROMPT).toContain('stay inside the plan');
    expect(IT_SUPPORT_SYSTEM_PROMPT).toContain('Back up a configuration file before you edit it');
    expect(IT_SUPPORT_SYSTEM_PROMPT).toContain('Never delete or overwrite the user\'s data');
  });

  it('should leave the project files alone', () => {
    expect(IT_SUPPORT_SYSTEM_PROMPT).toContain('Do not change the project\'s code or its files; environment work only.');
  });

  it('should ask the user through questions and answer inside the final response block', () => {
    expect(IT_SUPPORT_SYSTEM_PROMPT).toContain(USER_QUESTIONS_BRIEF);
    expect(IT_SUPPORT_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
  });

  describe('re-entry note', () => {
    it('should send the agent back to its role guide', () => {
      expect(IT_SUPPORT_REENTRY_NOTE.startsWith('[RE-ENTRY]')).toBe(true);
      expect(IT_SUPPORT_REENTRY_NOTE).toContain('a session you started as the IT Support Agent');
      expect(IT_SUPPORT_REENTRY_NOTE).toContain(`<skill_read name="${SKILL_NAMES.roleGuide}"/>`);
    });

    it('should carry the approval rule and the data and secret protections', () => {
      expect(IT_SUPPORT_REENTRY_NOTE).toContain('change nothing on the machine until the user approves your plan');
      expect(IT_SUPPORT_REENTRY_NOTE).toContain('an approval covers that plan only');
      expect(IT_SUPPORT_REENTRY_NOTE).toContain('never delete the user\'s data or expose a secret');
    });
  });
});
