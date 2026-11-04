import { describe, expect, it } from 'vitest';

import { USER_QUESTIONS_INSTRUCTIONS, USER_QUESTIONS_REMINDER } from './user-questions.prompt.js';


describe('user-questions.prompt', () => {
  it('should teach the question grammar and how the answers come back', () => {
    expect(USER_QUESTIONS_INSTRUCTIONS).toContain('<question rationale="why the answer matters">question text<option>first choice</option>');
    expect(USER_QUESTIONS_INSTRUCTIONS).toContain('Never add an "Other" option');
    expect(USER_QUESTIONS_INSTRUCTIONS).toContain('only questions that stand on their own');
    expect(USER_QUESTIONS_INSTRUCTIONS).toContain('The answers arrive as `<user_answers>`');
  });

  it('should explain that files the user attaches arrive with the answer', () => {
    expect(USER_QUESTIONS_INSTRUCTIONS).toContain('<attachment path="..."/>');
  });

  it('should remind the agent to ask with tags instead of prose', () => {
    expect(USER_QUESTIONS_REMINDER).toContain('never ask in plain prose');
  });
});
