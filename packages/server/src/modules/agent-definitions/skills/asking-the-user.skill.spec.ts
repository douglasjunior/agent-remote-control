import { describe, expect, it } from '@rstest/core';

import { skillContext } from '../testing/skill-context.fixture.js';

import { ASKING_THE_USER_SKILL } from './asking-the-user.skill.js';


describe('asking-the-user skill', () => {
  const skill = ASKING_THE_USER_SKILL.buildContent(skillContext());

  it('should be read by the roles that ask the user', () => {
    expect(ASKING_THE_USER_SKILL).toMatchObject({ name: 'asking-the-user', roles: ['CEO', 'PRODUCT_OWNER', 'UX_DESIGNER', 'TECH_LEAD', 'IT_SUPPORT'] });
  });

  it('should teach the question grammar and how each question stands on its own', () => {
    expect(skill).toContain('<question rationale="why the answer matters">question text<option recommended>first choice</option>');
    expect(skill).toContain('never an "Other" option');
    expect(skill).toContain('each question must stand on its own');
    expect(skill).toContain('Always fill `rationale`');
    expect(skill).toContain('recommend only what is safe to proceed with');
    expect(skill).toContain('accepting it is an informed decision in one click');
  });

  it('should look up facts before each round instead of asking them', () => {
    expect(skill).toContain('## Facts Are Not Questions');
    expect(skill).toContain('ask only what needs their judgment');
  });

  it('should ask the frontier of a decision tree per round and update it after the answers', () => {
    expect(skill).toContain('map the decisions the work needs as a tree');
    expect(skill).toContain('Each round asks the frontier: every open decision whose prerequisites are settled, all at once');
    expect(skill).toContain('After the answers, update the map');
  });

  it('should end the interview with an empty frontier and a confirmed summary', () => {
    expect(skill).toContain('Stop asking only when the frontier is empty and nothing the work depends on was assumed without the user');
    expect(skill).toContain('a last short round confirms the summary');
    expect(skill).toContain('A correction reopens only the decisions it touches');
  });

  it('should explain how the answers come back', () => {
    expect(skill).toContain('They arrive as `<user_answers>`');
    expect(skill).toContain('<attachment path="..."/>');
    expect(skill).toContain('`status="timed_out"`');
  });
});
