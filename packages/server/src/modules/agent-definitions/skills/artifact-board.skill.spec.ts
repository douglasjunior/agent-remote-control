import { describe, expect, it } from 'vitest';

import { skillContext } from '../testing/skill-context.fixture.js';

import { ARTIFACT_BOARD_SKILL } from './artifact-board.skill.js';


describe('artifact-board skill', () => {
  const skill = ARTIFACT_BOARD_SKILL.buildContent(skillContext({ workspaceDir: '/home/user/workspaces' }));

  it('should be read by the CEO only', () => {
    expect(ARTIFACT_BOARD_SKILL).toMatchObject({ name: 'artifact-board', roles: ['CEO'] });
  });

  it('should turn new requests into artifacts and route them by status', () => {
    expect(skill).toContain('List the board');
    expect(skill).toContain('both `skipped` for a simple, well-defined change');
    expect(skill).toContain('| `in_review` | Work ready for review |');
    expect(skill).toContain('without a remote, the branch is reviewed locally');
    expect(skill).toContain('After every `<agent_result>`, update the board before anything else');
  });

  it('should test approved work in practice, recording every verdict as its own status', () => {
    expect(skill).toContain('| `approved` | Review passed, ready for testing | Set `in_testing` and delegate to the agent that tests in practice');
    expect(skill).toContain('| `in_testing` | Being tested in practice | Its verdict FAILED sets `changes_requested`.');
    expect(skill).toContain('`<artifact_update id="T-3" status="approved"/>` comes before `<artifact_update id="T-3" status="in_testing"/>`');
    expect(skill).toContain('`review_findings` or `test_report` section');
  });

  it('should explain delegating with an artifact and carry the full request grammar', () => {
    expect(skill).toContain('`<delegate role="ROLE" summary="..." artifact="T-3">what to do with it now</delegate>`');
    expect(skill).toContain('## Request Grammar');
    expect(skill).toContain('`<artifact_list type="feature"');
  });
});
