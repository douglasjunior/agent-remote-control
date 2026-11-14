import { describe, expect, it } from 'vitest';

import { USER_QUESTIONS_GUIDE } from '../prompts/user-questions.prompt.js';
import { skillContext } from '../testing/skill-context.fixture.js';

import { ASKING_THE_USER_SKILL } from './asking-the-user.skill.js';


describe('asking-the-user skill', () => {
  it('should hold the full guide for every role that asks the user', () => {
    expect(ASKING_THE_USER_SKILL).toMatchObject({ name: 'asking-the-user', roles: ['DEVELOPER', 'GIT_OPS', 'PRODUCT_OWNER', 'TECH_LEAD'] });
    expect(ASKING_THE_USER_SKILL.buildContent(skillContext())).toBe(`# Asking the User\n\n${USER_QUESTIONS_GUIDE}`);
  });
});
