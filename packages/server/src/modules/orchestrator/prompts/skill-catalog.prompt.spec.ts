import { describe, expect, it } from 'vitest';

import { buildSkillCatalogPrompt } from './skill-catalog.prompt.js';


describe('buildSkillCatalogPrompt', () => {
  const skills = [
    { name: 'playwright-web', description: 'Testing a web interface.' },
    { name: 'api-testing', description: 'Testing an HTTP API.' },
  ];

  it('lists each skill with when to use it, read through a request, besides the skills a project keeps in its files', () => {
    const prompt = buildSkillCatalogPrompt(skills);

    expect(prompt.startsWith('[SKILLS]\n')).toBe(true);
    expect(prompt).toContain('The skills listed here are kept by the server, not in any folder, so you read one only with <skill_read name="skill-name"/>');
    expect(prompt).toContain('They add to the guidance and skills a project keeps in its own files, which you still follow.');
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
