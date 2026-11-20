import { describe, expect, it } from '@rstest/core';

import { skillContext } from '../testing/skill-context.fixture.js';

import { REVIEW_PUBLISHING_SKILL } from './review-publishing.skill.js';


describe('review-publishing skill', () => {
  const skill = REVIEW_PUBLISHING_SKILL.buildContent(skillContext());

  it('should be read by the code reviewer only', () => {
    expect(REVIEW_PUBLISHING_SKILL).toMatchObject({ name: 'review-publishing', roles: ['CODE_REVIEWER'] });
  });

  it('should prefer the provider MCP tools, then its CLI, and keep the findings on the task without either', () => {
    expect(skill).toContain('the provider\'s MCP tools when your session has them');
    expect(skill).toContain('do not fall back to `curl`, raw REST calls or ad-hoc scripts');
    expect(skill).toContain('The findings stay on the task only, and your final answer says so.');
  });

  it('should report a failing check as a finding from the pipeline\'s own output', () => {
    expect(skill).toContain('A failing check is a finding, reported from the pipeline\'s own output');
  });

  it('should anchor a finding about a line inline in the new version of the file', () => {
    expect(skill).toContain('anchored to that line in the new version of the file (`side: RIGHT`');
  });

  it('should put a file-wide finding in the main discussion with the summary of the review', () => {
    expect(skill).toContain('A file-wide or architectural finding goes in the main discussion');
  });

  it('should submit the review with the verdict and resolve the threads of fixed findings on a later review', () => {
    expect(skill).toContain('submit the review as approve or request changes, matching your verdict');
    expect(skill).toContain('resolve or answer the threads of the findings that were fixed instead of opening them again');
  });

  it('should give the link of each comment in the answer', () => {
    expect(skill).toContain('Give the link of each comment you published');
  });
});
