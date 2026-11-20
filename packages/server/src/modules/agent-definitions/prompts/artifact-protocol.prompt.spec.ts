import { describe, expect, it } from '@rstest/core';

import {
  CEO_ARTIFACT_ACCESS,
  DEVELOPER_ARTIFACT_ACCESS,
  GIT_OPS_ARTIFACT_ACCESS,
  PRODUCT_OWNER_ARTIFACT_ACCESS,
} from '../constants/artifact-access.constant.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';

import { buildArtifactProtocolBrief } from './artifact-protocol.prompt.js';


describe('artifact-protocol.prompt', () => {
  it('should open with the board and send the agent to the board-requests skill for every other request', () => {
    const brief = buildArtifactProtocolBrief(DEVELOPER_ARTIFACT_ACCESS);

    expect(brief.startsWith('### The Board\n')).toBe(true);
    expect(brief).toContain(`in the \`${SKILL_NAMES.boardRequests}\` skill, written for your role`);
  });

  it('should always give the read and comment requests', () => {
    const brief = buildArtifactProtocolBrief({ scope: 'task', sections: [], fields: [] });

    expect(brief).toContain('`<artifact_read id="T-1"/>`');
    expect(brief).toContain('`<artifact_comment id="T-1">text</artifact_comment>`');
  });

  it('should explain that writing requests ride with the final answer and reading ones get their results first', () => {
    const brief = buildArtifactProtocolBrief(DEVELOPER_ARTIFACT_ACCESS);

    expect(brief).toContain('Requests that write go in the same final response as your final answer');
    expect(brief).toContain('A response that reads gets `<request_results>` back first');
  });

  describe('scope', () => {
    it('should limit an agent of the task scope to tasks, and to the task it was delegated', () => {
      const brief = buildArtifactProtocolBrief(DEVELOPER_ARTIFACT_ACCESS);

      expect(brief).toContain('reads the full content of tasks.');
      expect(brief).toContain('You read tasks only and change only the task you were delegated, whose content opens your prompt in a `[DELEGATED_ARTIFACT]` block.');
      expect(brief).not.toContain('is not changed under you');
    });

    it.each([
      ['tree', PRODUCT_OWNER_ARTIFACT_ACCESS],
      ['board', CEO_ARTIFACT_ACCESS],
    ])('should let an agent of the %s scope read any artifact and leave those held by others alone', (_scope, access) => {
      const brief = buildArtifactProtocolBrief(access);

      expect(brief).toContain('reads the full content of artifacts.');
      expect(brief).toContain('An artifact another agent holds is not changed under you; comment on it instead.');
      expect(brief).not.toContain('You read tasks only');
    });
  });

  describe('creating', () => {
    it('should show the create request to an agent that may create artifacts', () => {
      expect(buildArtifactProtocolBrief(PRODUCT_OWNER_ARTIFACT_ACCESS)).toContain('<artifact_create type="task" title="..." project="my-app"><section name="overview">Markdown</section></artifact_create>');
    });

    it('should leave the create request out for an agent that may not', () => {
      expect(buildArtifactProtocolBrief(DEVELOPER_ARTIFACT_ACCESS)).not.toContain('<artifact_create');
    });

    it('should add the overview of a created artifact to the sections of an agent that does not write it otherwise', () => {
      const brief = buildArtifactProtocolBrief({ scope: 'tree', create: true, sections: ['technical_solution'], fields: [] });

      expect(brief).toContain('Sections you write: `technical_solution`, and the `overview` of an artifact you create.');
    });

    it('should not repeat the overview when the agent writes it already', () => {
      const brief = buildArtifactProtocolBrief(CEO_ARTIFACT_ACCESS);

      expect(brief).toContain('Sections you write: `overview`.');
      expect(brief).not.toContain('of an artifact you create');
    });

    it('should not mention the overview of a created artifact to an agent that cannot create', () => {
      expect(buildArtifactProtocolBrief({ scope: 'task', sections: ['review_findings'], fields: [] })).not.toContain('of an artifact you create');
    });
  });

  describe('updating', () => {
    it('should leave the update request out for an agent that writes nothing', () => {
      const brief = buildArtifactProtocolBrief({ scope: 'task', sections: [], fields: [] });

      expect(brief).not.toContain('<artifact_update');
      expect(brief).toContain('You write no section. Record what the next agent must know as a comment.');
    });

    it('should show the section and the pull request of an agent that writes both', () => {
      const brief = buildArtifactProtocolBrief(DEVELOPER_ARTIFACT_ACCESS);

      expect(brief).toContain('<artifact_update id="T-1" branch="feat/t-1-login"><section name="implementation_notes">Markdown</section><pull_request url="https://..." state="open"/></artifact_update>');
      expect(brief).toContain('Sections you write: `implementation_notes`. Fields you change: branch, pull_requests.');
    });

    it('should show only the pull request and name the fields of an agent that writes no section', () => {
      const brief = buildArtifactProtocolBrief(GIT_OPS_ARTIFACT_ACCESS);

      expect(brief).toContain('<artifact_update id="T-1" branch="feat/t-1-login"><pull_request url="https://..." state="open"/></artifact_update>');
      expect(brief).not.toContain('<section name=');
      expect(brief).toContain('You write no section; fields you change: branch, pull_requests. Record what the next agent must know as a comment.');
    });

    it('should show the status of an agent that sets it, with the first section it writes', () => {
      const brief = buildArtifactProtocolBrief(CEO_ARTIFACT_ACCESS);

      expect(brief).toContain('<artifact_update id="T-1" status="in_progress"><section name="overview">Markdown</section></artifact_update>');
    });

    it('should show a bare update for an agent that writes sections but no fields', () => {
      const brief = buildArtifactProtocolBrief({ scope: 'task', sections: ['review_findings'], fields: [] });

      expect(brief).toContain('<artifact_update id="T-1"><section name="review_findings">Markdown</section></artifact_update>');
      expect(brief).toContain('Sections you write: `review_findings`.');
      expect(brief).not.toContain('Fields you change');
    });
  });
});
