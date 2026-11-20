import { describe, expect, it } from '@rstest/core';

import { FINAL_RESPONSE_CLOSE, FINAL_RESPONSE_OPEN } from '../../orchestrator/constants/final-response.constant.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';

import { buildReentryNote } from './reentry-note.prompt.js';


describe('reentry-note.prompt', () => {
  it('should open with the re-entry marker and name the role', () => {
    const note = buildReentryNote('Example Agent', [], 'tags');

    expect(note.startsWith('[RE-ENTRY]\n')).toBe(true);
    expect(note).toContain('a session you started as the Example Agent');
  });

  it('should send the agent to the role guide skill for its full instructions', () => {
    expect(buildReentryNote('Example Agent', [], 'tags')).toContain(`<skill_read name="${SKILL_NAMES.roleGuide}"/>`);
  });

  it('should list each rule as a bullet, in order, before the closing rule', () => {
    const lines = buildReentryNote('Example Agent', ['first rule', 'second rule'], 'tags').split('\n');

    expect(lines.slice(2, 4)).toEqual(['- first rule', '- second rule']);
    expect(lines).toHaveLength(5);
  });

  it('should always require background work to finish before the final answer inside the final response block', () => {
    const closing = buildReentryNote('Example Agent', [], 'tags').split('\n').at(-1);

    expect(closing).toContain('every subagent and background task you started has finished');
    expect(closing).toContain(`${FINAL_RESPONSE_OPEN}...${FINAL_RESPONSE_CLOSE}`);
  });

  describe('on the tools interface', () => {
    const note = buildReentryNote('Example Agent', ['first rule'], 'tools');

    it('should name the tools of the arc server plainly, so a session begun on the tags moves to them', () => {
      expect(note).toContain('a session you started as the Example Agent. The board and your skills are reached through the tools of the `arc` MCP server, which you call during your turn and which answer at once: `artifact_read` reads a task and `skill_read` a skill.');
    });

    it('should send the agent to the role guide through skill_read', () => {
      expect(note).toContain(`read them again with \`skill_read\` and the \`${SKILL_NAMES.roleGuide}\` skill before going on.`);
      expect(note).not.toContain('<skill_read');
    });

    it('should keep the rules and the closing rule', () => {
      const lines = note.split('\n');

      expect(lines[2]).toBe('- first rule');
      expect(lines.at(-1)).toContain(`${FINAL_RESPONSE_OPEN}...${FINAL_RESPONSE_CLOSE}`);
    });
  });
});
