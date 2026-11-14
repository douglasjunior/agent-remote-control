import { describe, expect, it } from 'vitest';

import {
  CEO_ARTIFACT_ACCESS,
  CODE_REVIEWER_ARTIFACT_ACCESS,
  DEVELOPER_ARTIFACT_ACCESS,
  GIT_OPS_ARTIFACT_ACCESS,
  PRODUCT_OWNER_ARTIFACT_ACCESS,
} from '../constants/artifact-access.constant.js';

import { buildArtifactProtocolBrief, buildArtifactProtocolInstructions, buildArtifactProtocolReminder } from './artifact-protocol.prompt.js';


describe('artifact-protocol.prompt', () => {
  it('describes the board and the request round trip to every role', () => {
    const instructions = buildArtifactProtocolInstructions(DEVELOPER_ARTIFACT_ACCESS);

    expect(instructions).toContain('A feature groups the tasks of one initiative');
    expect(instructions).toContain('- `technical_solution`: Technical solution');
    expect(instructions).toContain('When the response also asks the user questions, it goes on as usual and the results open your next prompt.');
    expect(instructions).toContain('Otherwise the results come back right away and the response is not taken as your final answer');
  });

  it('gives an agent that works on tasks only the task grammar it may use', () => {
    const instructions = buildArtifactProtocolInstructions(DEVELOPER_ARTIFACT_ACCESS);

    expect(instructions).toContain('`<artifact_list status="ready,in_progress"/>` lists the tasks of the board');
    expect(instructions).toContain('`<artifact_read id="T-1,T-2"/>` reads the full content of tasks');
    expect(instructions).not.toContain('tree="true"');
    expect(instructions).not.toContain('<artifact_create');
    expect(instructions).toContain('Attributes you may set: branch="<branch name>" (or "none").');
    expect(instructions).toContain('Children: `<section name="..." mode="replace|append">Markdown</section>`');
    expect(instructions).toContain('- Sections you write: `implementation_notes`.');
    expect(instructions).toContain('you change only the task you were delegated, whose content opens your prompt in a `[DELEGATED_ARTIFACT]` block');
    expect(buildArtifactProtocolReminder(DEVELOPER_ARTIFACT_ACCESS)).toContain('You read tasks and change only the task you were delegated.');
  });

  it('lets the agent that handles remotes link pull requests and the reviewer write only its findings', () => {
    const gitOps = buildArtifactProtocolInstructions(GIT_OPS_ARTIFACT_ACCESS);
    expect(gitOps).toContain('Children: <pull_request url="https://..." title="..." state="open|merged|closed"/> inside the tag, one per pull request.');
    expect(gitOps).toContain('- You write no section. Record what the next agent must know as a comment on the artifact.');
    const reviewer = buildArtifactProtocolInstructions(CODE_REVIEWER_ARTIFACT_ACCESS);
    expect(reviewer).toContain('- Sections you write: `review_findings`.');
    expect(reviewer).not.toContain('Attributes you may set');
  });

  it('gives the agents that manage the board creation and whole features', () => {
    const instructions = buildArtifactProtocolInstructions(PRODUCT_OWNER_ARTIFACT_ACCESS);

    expect(instructions).toContain('`<artifact_read id="F-1" tree="true"/>` reads a feature with the full content of every task under it.');
    expect(instructions).toContain('<artifact_create type="task" title="Short title" project="my-app" parent="F-1" depends_on="T-1" ref="login-api" business_refinement="pending" technical_refinement="pending">');
    expect(instructions).toContain('A refinement left out is `pending`.');
    expect(instructions).toContain('Meanwhile you cannot change it; comment instead.');
    expect(instructions).toContain('When you were delegated an artifact, its content opens your prompt');
    expect(buildArtifactProtocolReminder(PRODUCT_OWNER_ARTIFACT_ACCESS)).toContain('An artifact another agent holds is not changed under you');
  });

  it('lets the coordinator steer a held artifact through its status and refinements', () => {
    const instructions = buildArtifactProtocolInstructions(CEO_ARTIFACT_ACCESS);

    expect(instructions).toContain('Meanwhile you change only its status and refinement states; comment instead.');
    expect(instructions).toContain('When the response also delegates or asks the user questions, it goes on as usual');
    expect(instructions).toContain('status="backlog|ready|in_progress|in_review|changes_requested|approved|in_testing|done|blocked|cancelled" (`frozen` is set by the server');
  });

  it('leaves the refinement attributes out of creation for an agent that cannot set them', () => {
    const instructions = buildArtifactProtocolInstructions({ scope: 'tree', create: true, sections: [], fields: [] });

    expect(instructions).toContain('ref="login-api">');
    expect(instructions).not.toContain('A refinement left out');
  });

  describe('brief', () => {
    it('gives an agent that works on one task the requests it uses in most tasks and the skill with the rest', () => {
      const developer = buildArtifactProtocolBrief(DEVELOPER_ARTIFACT_ACCESS);

      expect(developer).toContain('A response with nothing but requests is not your final answer');
      expect(developer).toContain('`<artifact_read id="T-1"/>` reads the full content of tasks.');
      expect(developer).toContain('`<artifact_update id="T-1" branch="feat/t-1-login"><section name="implementation_notes">Markdown</section></artifact_update>`');
      expect(developer).toContain('Sections you write: `implementation_notes`. Fields you change: branch.');
      expect(developer).toContain('change only the task you were delegated');
      expect(developer).toContain('is in the `board-requests` skill, written for your role');
      expect(developer).not.toContain('<artifact_create');
    });

    it('shows each role the writes it may make', () => {
      expect(buildArtifactProtocolBrief(GIT_OPS_ARTIFACT_ACCESS)).toContain('<artifact_update id="T-1" branch="feat/t-1-login"><pull_request url="https://..." state="open"/></artifact_update>');
      expect(buildArtifactProtocolBrief(GIT_OPS_ARTIFACT_ACCESS)).toContain('You write no section; fields you change: branch, pull_requests.');
      expect(buildArtifactProtocolBrief(CEO_ARTIFACT_ACCESS)).toContain('<artifact_update id="T-1" status="in_progress"><section name="overview">Markdown</section></artifact_update>');
      expect(buildArtifactProtocolBrief(CEO_ARTIFACT_ACCESS)).toContain('<artifact_create type="task"');
      expect(buildArtifactProtocolBrief(CEO_ARTIFACT_ACCESS)).toContain('reads the full content of artifacts.');
      expect(buildArtifactProtocolBrief(CEO_ARTIFACT_ACCESS)).toContain('An artifact another agent holds is not changed under you');
      const readOnly = buildArtifactProtocolBrief({ scope: 'task', sections: [], fields: [] });
      expect(readOnly).toContain('- You write no section. Record what the next agent must know as a comment.');
      expect(readOnly).not.toContain('<artifact_update');
    });
  });
});
