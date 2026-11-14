import { describe, expect, it } from 'vitest';

import { buildSkillCatalogPrompt } from './skill-catalog.prompt.js';


describe('buildSkillCatalogPrompt', () => {
  const skills = [
    { name: 'playwright-web', description: 'Testing a web interface.' },
    { name: 'api-testing', description: 'Testing an HTTP API.' },
  ];

  it('lists each skill with when to use it and explains that a skill is read, never looked for in files', () => {
    const prompt = buildSkillCatalogPrompt(skills);

    expect(prompt.startsWith('[SKILLS]\n')).toBe(true);
    expect(prompt).toContain('They live on the server, not in your working directory, so a skill reaches you only by reading it');
    expect(prompt).toContain('<skill_read name="skill-name"/>');
    expect(prompt).not.toContain('<skill_write>');
    expect(prompt).toContain('- playwright-web: Testing a web interface.\n- api-testing: Testing an HTTP API.\n[/SKILLS]');
  });

  it('tells a role that writes skills how it manages the skills of every role', () => {
    const prompt = buildSkillCatalogPrompt(skills, true);

    expect(prompt).toContain('<skill_list/> lists them all with the roles that read them, <skill_read> reads any of them, and <skill_write> creates or changes one');
    expect(prompt).toContain('read the skill below about writing skills.\n- playwright-web');
  });
});
