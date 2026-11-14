import { describe, expect, it } from 'vitest';

import { USER_QUESTIONS_BRIEF, USER_QUESTIONS_REMINDER } from './user-questions.prompt.js';


describe('user-questions.prompt', () => {
  it('should give the question tag in brief and send the agent to the skill with the guide', () => {
    expect(USER_QUESTIONS_BRIEF.startsWith('### Asking the User\n')).toBe(true);
    expect(USER_QUESTIONS_BRIEF).toContain('<question rationale="why the answer matters">question<option recommended>safest choice</option>');
    expect(USER_QUESTIONS_BRIEF).toContain('Read the `asking-the-user` skill before your first question in a session');
    expect(USER_QUESTIONS_BRIEF.length).toBeLessThan(600);
  });

  it('should remind the agent to ask with tags instead of prose', () => {
    expect(USER_QUESTIONS_REMINDER).toContain('never ask in plain prose');
    expect(USER_QUESTIONS_REMINDER).toContain('The `asking-the-user` skill has the guide.');
  });
});
