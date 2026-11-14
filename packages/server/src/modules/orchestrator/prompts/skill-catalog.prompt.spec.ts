import { describe, expect, it } from 'vitest';

import { buildSkillCatalogPrompt } from './skill-catalog.prompt.js';


describe('buildSkillCatalogPrompt', () => {
  it('lists each skill with when to use it and explains how to read one', () => {
    const prompt = buildSkillCatalogPrompt([
      { name: 'playwright-web', description: 'Testing a web interface.' },
      { name: 'api-testing', description: 'Testing an HTTP API.' },
    ]);

    expect(prompt.startsWith('[SKILLS]\n')).toBe(true);
    expect(prompt).toContain('<skill_read name="skill-name"/>');
    expect(prompt).toContain('- playwright-web: Testing a web interface.\n- api-testing: Testing an HTTP API.\n[/SKILLS]');
  });
});
