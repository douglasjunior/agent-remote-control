import { describe, expect, it } from 'vitest';

import { USER_QUESTIONS_BRIEF, USER_QUESTIONS_INSTRUCTIONS, USER_QUESTIONS_REMINDER } from './user-questions.prompt.js';


describe('user-questions.prompt', () => {
  it('should teach the question grammar and how the answers come back', () => {
    expect(USER_QUESTIONS_INSTRUCTIONS).toContain('<question rationale="why the answer matters">question text<option>first choice</option>');
    expect(USER_QUESTIONS_INSTRUCTIONS).toContain('Never add an "Other" option');
    expect(USER_QUESTIONS_INSTRUCTIONS).toContain('only questions that stand on their own');
    expect(USER_QUESTIONS_INSTRUCTIONS).toContain('The answers arrive as `<user_answers>`');
  });

  it('should ask for the context and the rationale that let a question stand on its own', () => {
    expect(USER_QUESTIONS_INSTRUCTIONS).toContain('every question must make sense on its own');
    expect(USER_QUESTIONS_INSTRUCTIONS).toContain('Always fill `rationale`');
  });

  it('should explain that files the user attaches arrive with the answer', () => {
    expect(USER_QUESTIONS_INSTRUCTIONS).toContain('<attachment path="..."/>');
  });

  it('should remind the agent to ask with tags instead of prose', () => {
    expect(USER_QUESTIONS_REMINDER).toContain('never ask in plain prose');
    expect(USER_QUESTIONS_REMINDER).toContain('The `asking-the-user` skill has the full guide.');
  });

  it('should give the roles that ask now and then the grammar in brief and the skill with the guide', () => {
    expect(USER_QUESTIONS_BRIEF).toContain('<question rationale="why the answer matters">question<option recommended>safest choice</option>');
    expect(USER_QUESTIONS_BRIEF).toContain('Read the `asking-the-user` skill before asking');
    expect(USER_QUESTIONS_BRIEF.length).toBeLessThan(USER_QUESTIONS_INSTRUCTIONS.length / 3);
  });
});
