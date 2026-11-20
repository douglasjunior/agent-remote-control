import { describe, expect, it } from '@rstest/core';

import {
  CEO_ARTIFACT_ACCESS,
  CODE_REVIEWER_ARTIFACT_ACCESS,
  DEVELOPER_ARTIFACT_ACCESS,
  GIT_OPS_ARTIFACT_ACCESS,
  PRODUCT_OWNER_ARTIFACT_ACCESS,
  TECH_LEAD_ARTIFACT_ACCESS,
} from '../constants/artifact-access.constant.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import { buildArtifactProtocolBrief } from '../prompts/artifact-protocol.prompt.js';
import { skillContext } from '../testing/skill-context.fixture.js';

import { BOARD_REQUESTS_SKILL, buildBoardRequestsBody } from './board-requests.skill.js';


describe('board-requests skill', () => {
  it('should be read by every executor role, the CEO having the board in its own skill', () => {
    expect(BOARD_REQUESTS_SKILL.name).toBe('board-requests');
    expect(BOARD_REQUESTS_SKILL.roles).toEqual(['GIT_OPS', 'PRODUCT_OWNER', 'TECH_LEAD', 'DEVELOPER', 'CODE_REVIEWER', 'QA']);
  });

  it('should hold the full board protocol, written for the access of the reader', () => {
    const developer = BOARD_REQUESTS_SKILL.buildContent(skillContext({ artifacts: DEVELOPER_ARTIFACT_ACCESS }));
    const lead = BOARD_REQUESTS_SKILL.buildContent(skillContext({ artifacts: TECH_LEAD_ARTIFACT_ACCESS }));

    expect(developer.startsWith('# Board Requests\n\nThe work of this conversation lives on a board')).toBe(true);
    expect(developer).toBe(`# Board Requests\n\n${buildBoardRequestsBody(DEVELOPER_ARTIFACT_ACCESS)}`);
    expect(developer).not.toContain('tree="true"');
    expect(lead).toContain('tree="true"');
  });

  it('should be named by the board brief of every executor', () => {
    expect(buildArtifactProtocolBrief(DEVELOPER_ARTIFACT_ACCESS)).toContain(`in the \`${SKILL_NAMES.boardRequests}\` skill`);
  });

  describe('body', () => {
    it('should describe the board and the request round trip to every role', () => {
      const instructions = buildBoardRequestsBody(DEVELOPER_ARTIFACT_ACCESS);

      expect(instructions).toContain('A feature groups the tasks of one initiative');
      expect(instructions).toContain('- `technical_solution`: Technical solution');
      expect(instructions).toContain('When the response also asks the user questions, it goes on as usual and the results open your next prompt.');
      expect(instructions).toContain('A response that reads (list, read), or whose request failed, gets the results right away and is not taken as your final answer');
    });

    it('should give an agent that works on tasks only the task grammar it may use', () => {
      const instructions = buildBoardRequestsBody(DEVELOPER_ARTIFACT_ACCESS);

      expect(instructions).toContain('`<artifact_list status="ready,in_progress"/>` lists the tasks of the board');
      expect(instructions).toContain('`<artifact_read id="T-1,T-2"/>` reads the full content of tasks');
      expect(instructions).not.toContain('tree="true"');
      expect(instructions).not.toContain('<artifact_create');
      expect(instructions).toContain('Attributes you may set: branch="<branch name>" (or "none").');
      expect(instructions).toContain('Children: `<section name="..." mode="replace|append">Markdown</section>`');
      expect(instructions).toContain('<pull_request url="https://..." title="..." state="open|merged|closed"/> inside the tag, one per pull request');
      expect(instructions).toContain('Fields you change: branch, pull_requests.');
      expect(instructions).toContain('- Sections you write: `implementation_notes`.');
      expect(instructions).toContain('you change only the task you were delegated, whose content opens your prompt in a `[DELEGATED_ARTIFACT]` block');
    });

    it('should let the agent that handles remotes link pull requests and the reviewer write only its findings', () => {
      const gitOps = buildBoardRequestsBody(GIT_OPS_ARTIFACT_ACCESS);
      expect(gitOps).toContain('Attributes you may set: branch=');
      expect(gitOps).toContain('Children: <pull_request url="https://..." title="..." state="open|merged|closed"/> inside the tag, one per pull request.');
      expect(gitOps).toContain('- You write no section. Record what the next agent must know as a comment on the artifact.');
      const reviewer = buildBoardRequestsBody(CODE_REVIEWER_ARTIFACT_ACCESS);
      expect(reviewer).toContain('- Sections you write: `review_findings`.');
      expect(reviewer).not.toContain('Attributes you may set');
    });

    it('should give the agents that manage the board creation and whole features', () => {
      const instructions = buildBoardRequestsBody(PRODUCT_OWNER_ARTIFACT_ACCESS);

      expect(instructions).toContain('`<artifact_read id="F-1" tree="true"/>` reads a feature with the full content of every task under it.');
      expect(instructions).toContain('<artifact_create type="task" title="Short title" project="my-app" parent="F-1" depends_on="T-1" ref="login-api" business_refinement="pending" technical_refinement="pending">');
      expect(instructions).toContain('A refinement left out is `pending`.');
      expect(instructions).toContain('Meanwhile you cannot change it; comment instead.');
      expect(instructions).toContain('When you were delegated an artifact, its content opens your prompt');
    });

    it('should let the CEO steer a held artifact through its status and refinements', () => {
      const instructions = buildBoardRequestsBody(CEO_ARTIFACT_ACCESS);

      expect(instructions).toContain('Meanwhile you change only its status and refinement states; comment instead.');
      expect(instructions).toContain('When the response also delegates or asks the user questions, it goes on as usual');
      expect(instructions).toContain('status="backlog|ready|in_progress|in_review|changes_requested|approved|in_testing|done|blocked|cancelled" (the server sets the status a delegation or a verdict leaves, so set one only for a decision; `frozen` is set by the server');
    });

    it('should leave the children out of the update of an agent that writes fields only', () => {
      const instructions = buildBoardRequestsBody({ scope: 'task', sections: [], fields: ['branch'] });

      expect(instructions).toContain('Attributes you may set: branch=');
      expect(instructions).not.toContain('Children:');
    });

    it('should leave the refinement attributes out of creation for an agent that cannot set them', () => {
      const instructions = buildBoardRequestsBody({ scope: 'tree', create: true, sections: [], fields: [] });

      expect(instructions).toContain('ref="login-api">');
      expect(instructions).not.toContain('A refinement left out');
    });
  });
});
