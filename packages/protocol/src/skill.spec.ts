import { describe, expect, it } from 'vitest';

import { skillDetailSchema, skillSummarySchema } from './skill.js';


describe('skill schemas', () => {
  it('accepts a summary and a detail with its content', () => {
    const summary = { name: 'api-testing', description: 'API.', roles: ['QA'], builtIn: true };

    expect(skillSummarySchema.parse(summary)).toEqual(summary);
    expect(skillDetailSchema.parse({ ...summary, content: '# API' })).toEqual({ ...summary, content: '# API' });
    expect(skillDetailSchema.safeParse(summary).success).toBe(false);
  });
});
