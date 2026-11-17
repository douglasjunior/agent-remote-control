import { describe, expect, it } from '@rstest/core';

import { skillContext } from '../testing/skill-context.fixture.js';

import { ASKING_THE_USER_SKILL } from './asking-the-user.skill.js';


describe('asking-the-user skill', () => {
  const skill = ASKING_THE_USER_SKILL.buildContent(skillContext());

  it('should be read by the roles that ask the user', () => {
    expect(ASKING_THE_USER_SKILL).toMatchObject({ name: 'asking-the-user', roles: ['CEO', 'PRODUCT_OWNER', 'TECH_LEAD', 'IT_SUPPORT'] });
  });

  it('should teach the question grammar and how each question stands on its own', () => {
    expect(skill).toContain('<question rationale="why the answer matters">question text<option recommended>first choice</option>');
    expect(skill).toContain('never an "Other" option');
    expect(skill).toContain('each question must stand on its own');
    expect(skill).toContain('Always fill `rationale`');
    expect(skill).toContain('recommend only what is safe to proceed with');
  });

  it('should keep dependent questions apart and explain how the answers come back', () => {
    expect(skill).toContain('One response holds only questions that stand on their own');
    expect(skill).toContain('They arrive as `<user_answers>`');
    expect(skill).toContain('<attachment path="..."/>');
    expect(skill).toContain('`status="timed_out"`');
  });
});
