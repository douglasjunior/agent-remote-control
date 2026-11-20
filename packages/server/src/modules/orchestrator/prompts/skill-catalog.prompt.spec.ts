import { describe, expect, it } from '@rstest/core';

import { buildSkillCatalogPrompt } from './skill-catalog.prompt.js';


describe('buildSkillCatalogPrompt', () => {
  const skills = [
    { name: 'playwright-web', description: 'Testing a web interface.' },
    { name: 'api-testing', description: 'Testing an HTTP API.' },
  ];

  describe('tags', () => {
    it('should list each skill with when to use it, read through a request, besides the skills a project keeps in its files', () => {
      const prompt = buildSkillCatalogPrompt(skills, 'tags');

      expect(prompt.startsWith('[SKILLS]\n')).toBe(true);
      expect(prompt).toContain('The skills listed here are kept by the server, not in any folder, so you read one only with <skill_read name="skill-name"/>');
      expect(prompt).toContain('They add to the guidance and skills a project keeps in its own files, which you still follow.');
      expect(prompt).toContain('<skill_read name="skill-name"/>');
      expect(prompt).toContain('its content comes back in <request_results> in your next prompt.');
      expect(prompt).not.toContain('<skill_write>');
      expect(prompt).toContain('- playwright-web: Testing a web interface.\n- api-testing: Testing an HTTP API.\n[/SKILLS]');
    });

    it('should tell a role that writes skills how it manages the skills of every role', () => {
      const prompt = buildSkillCatalogPrompt(skills, 'tags', true);

      expect(prompt).toContain('<skill_list/> lists them all with the roles that read them, <skill_read> reads any of them, and <skill_write> creates or changes one');
      expect(prompt).toContain('read the skill below about writing skills.\n- playwright-web');
    });
  });

  describe('tools', () => {
    it('should send the agent to the skill_read tool of the arc server, which answers at once', () => {
      const prompt = buildSkillCatalogPrompt(skills, 'tools');

      expect(prompt.startsWith('[SKILLS]\n')).toBe(true);
      expect(prompt).toContain('so you read one only with the `skill_read` tool of the `arc` MCP server, which returns its content at once (several names in one call): before work a skill describes, read it in full.');
      expect(prompt).toContain('They add to the guidance and skills a project keeps in its own files, which you still follow.');
      expect(prompt).toContain('- playwright-web: Testing a web interface.\n- api-testing: Testing an HTTP API.\n[/SKILLS]');
      expect(prompt).not.toContain('<skill_');
      expect(prompt).not.toContain('request_results');
    });

    it('should tell a role that writes skills which tools manage the skills of every role', () => {
      const prompt = buildSkillCatalogPrompt(skills, 'tools', true);

      expect(prompt).toContain('`skill_list` lists them all with the roles that read them, `skill_read` reads any of them, and `skill_write` creates or changes one');
      expect(prompt).not.toContain('<skill_');
    });
  });
});
