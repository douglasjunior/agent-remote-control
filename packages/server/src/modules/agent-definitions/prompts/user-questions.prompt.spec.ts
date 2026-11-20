import { describe, expect, it } from '@rstest/core';

import { SKILL_NAMES } from '../constants/skill-names.constant.js';

import { USER_QUESTIONS_BRIEF } from './user-questions.prompt.js';


describe('user-questions.prompt', () => {
  it('should give the question tag in brief', () => {
    expect(USER_QUESTIONS_BRIEF.startsWith('### Asking the User\n')).toBe(true);
    expect(USER_QUESTIONS_BRIEF).toContain('<question rationale="what the answer changes in the work">question text<option recommended>safest choice</option>');
    expect(USER_QUESTIONS_BRIEF).toContain('in your final response, never in plain prose');
  });

  it('should recommend the safest option first and treat a timed-out answer as provisional', () => {
    expect(USER_QUESTIONS_BRIEF).toContain('Put the option you recommend first and mark it `recommended`');
    expect(USER_QUESTIONS_BRIEF).toContain('`status="timed_out"` as provisional');
  });

  it('should keep each question standing on its own and the response free of dependent questions', () => {
    expect(USER_QUESTIONS_BRIEF).toContain('each question stands on its own');
    expect(USER_QUESTIONS_BRIEF).toContain('only questions that do not depend on each other\'s answers');
  });

  it('should send the agent to the skill with the rest of the guide', () => {
    expect(USER_QUESTIONS_BRIEF).toContain(`The \`${SKILL_NAMES.askingTheUser}\` skill covers the rest`);
  });
});
