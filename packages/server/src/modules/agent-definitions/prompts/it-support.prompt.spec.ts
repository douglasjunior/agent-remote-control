import { describe, expect, it } from '@rstest/core';

import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';
import { IT_SUPPORT_SYSTEM_PROMPT, IT_SUPPORT_TURN_REMINDER } from './it-support.prompt.js';
import { USER_QUESTIONS_BRIEF, USER_QUESTIONS_REMINDER } from './user-questions.prompt.js';


describe('it-support.prompt', () => {
  it('should investigate read-only before asking the user to approve a plan', () => {
    expect(IT_SUPPORT_SYSTEM_PROMPT).toContain('You are the IT Support Agent.');
    expect(IT_SUPPORT_SYSTEM_PROMPT).toContain('### Step 1: Investigate (read-only)');
    expect(IT_SUPPORT_SYSTEM_PROMPT).toContain('change nothing until the answer arrives');
    expect(IT_SUPPORT_SYSTEM_PROMPT).toContain('Each step says what will happen and why it is needed');
    expect(IT_SUPPORT_TURN_REMINDER).toContain('change nothing on the machine until the user approves your plan');
  });

  it('should stay inside the approved plan and protect the user\'s data and secrets', () => {
    expect(IT_SUPPORT_SYSTEM_PROMPT).toContain('stay inside the plan');
    expect(IT_SUPPORT_SYSTEM_PROMPT).toContain('Back up a configuration file before you edit it');
    expect(IT_SUPPORT_SYSTEM_PROMPT).toContain('Never delete or overwrite the user\'s data');
    expect(IT_SUPPORT_TURN_REMINDER).toContain('an approval covers that plan only');
  });

  it('should ask the user through questions and answer inside the final response block', () => {
    expect(IT_SUPPORT_SYSTEM_PROMPT).toContain(USER_QUESTIONS_BRIEF);
    expect(IT_SUPPORT_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
    expect(IT_SUPPORT_TURN_REMINDER).toContain(USER_QUESTIONS_REMINDER);
    expect(IT_SUPPORT_TURN_REMINDER).toContain('<final_response>...</final_response>');
  });
});
