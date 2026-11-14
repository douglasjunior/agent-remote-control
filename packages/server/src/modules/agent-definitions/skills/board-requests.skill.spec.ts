import { describe, expect, it } from 'vitest';

import { DEVELOPER_ARTIFACT_ACCESS, TECH_LEAD_ARTIFACT_ACCESS } from '../constants/artifact-access.constant.js';
import { buildArtifactProtocolInstructions, buildArtifactProtocolReminder } from '../prompts/artifact-protocol.prompt.js';
import { skillContext } from '../testing/skill-context.fixture.js';

import { BOARD_REQUESTS_SKILL } from './board-requests.skill.js';


describe('board-requests skill', () => {
  it('should be read by every executor role, the CEO having the board in its own skill', () => {
    expect(BOARD_REQUESTS_SKILL.name).toBe('board-requests');
    expect(BOARD_REQUESTS_SKILL.roles).toEqual(['GIT_OPS', 'PRODUCT_OWNER', 'TECH_LEAD', 'DEVELOPER', 'CODE_REVIEWER', 'QA']);
  });

  it('should hold the board protocol of the system prompt, written for the access of the reader', () => {
    const developer = BOARD_REQUESTS_SKILL.buildContent(skillContext({ artifacts: DEVELOPER_ARTIFACT_ACCESS }));
    const lead = BOARD_REQUESTS_SKILL.buildContent(skillContext({ artifacts: TECH_LEAD_ARTIFACT_ACCESS }));

    expect(developer.startsWith('# Board Requests\n\nThe work of this conversation lives on a board')).toBe(true);
    expect(developer).toContain(buildArtifactProtocolInstructions(DEVELOPER_ARTIFACT_ACCESS).replace('### The Board\n', ''));
    expect(developer).not.toContain('tree="true"');
    expect(lead).toContain('tree="true"');
  });

  it('should be named by the reminder every executor gets each turn', () => {
    expect(buildArtifactProtocolReminder(DEVELOPER_ARTIFACT_ACCESS)).toContain('read the `board-requests` skill before writing a request');
  });
});
