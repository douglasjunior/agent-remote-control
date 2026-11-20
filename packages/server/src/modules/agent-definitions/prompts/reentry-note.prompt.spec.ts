import { describe, expect, it } from '@rstest/core';

import { FINAL_RESPONSE_CLOSE, FINAL_RESPONSE_OPEN } from '../../orchestrator/constants/final-response.constant.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';

import { buildReentryNote } from './reentry-note.prompt.js';


describe('reentry-note.prompt', () => {
  it('should open with the re-entry marker and name the role', () => {
    const note = buildReentryNote('Example Agent', []);

    expect(note.startsWith('[RE-ENTRY]\n')).toBe(true);
    expect(note).toContain('a session you started as the Example Agent');
  });

  it('should send the agent to the role guide skill for its full instructions', () => {
    expect(buildReentryNote('Example Agent', [])).toContain(`<skill_read name="${SKILL_NAMES.roleGuide}"/>`);
  });

  it('should list each rule as a bullet, in order, before the closing rule', () => {
    const lines = buildReentryNote('Example Agent', ['first rule', 'second rule']).split('\n');

    expect(lines.slice(2, 4)).toEqual(['- first rule', '- second rule']);
    expect(lines).toHaveLength(5);
  });

  it('should always require background work to finish before the final answer inside the final response block', () => {
    const closing = buildReentryNote('Example Agent', []).split('\n').at(-1);

    expect(closing).toContain('every subagent and background task you started has finished');
    expect(closing).toContain(`${FINAL_RESPONSE_OPEN}...${FINAL_RESPONSE_CLOSE}`);
  });
});
