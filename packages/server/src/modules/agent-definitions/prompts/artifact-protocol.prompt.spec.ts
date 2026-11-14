import { describe, expect, it } from 'vitest';

import {
  CEO_ARTIFACT_ACCESS,
  DEVELOPER_ARTIFACT_ACCESS,
  GIT_OPS_ARTIFACT_ACCESS,
  PRODUCT_OWNER_ARTIFACT_ACCESS,
} from '../constants/artifact-access.constant.js';

import { buildArtifactProtocolBrief, buildArtifactProtocolReminder } from './artifact-protocol.prompt.js';


describe('artifact-protocol.prompt', () => {
  it('should remind each role of what it may change and of the skill with the grammar', () => {
    expect(buildArtifactProtocolReminder(DEVELOPER_ARTIFACT_ACCESS)).toContain('You read tasks and change only the task you were delegated.');
    expect(buildArtifactProtocolReminder(PRODUCT_OWNER_ARTIFACT_ACCESS)).toContain('An artifact another agent holds is not changed under you');
  });

  describe('brief', () => {
    it('should give an agent that works on one task the requests it uses in most tasks and the skill with the rest', () => {
      const developer = buildArtifactProtocolBrief(DEVELOPER_ARTIFACT_ACCESS);

      expect(developer).toContain('A response with nothing but requests is not your final answer');
      expect(developer).toContain('`<artifact_read id="T-1"/>` reads the full content of tasks.');
      expect(developer).toContain('`<artifact_update id="T-1" branch="feat/t-1-login"><section name="implementation_notes">Markdown</section></artifact_update>`');
      expect(developer).toContain('Sections you write: `implementation_notes`. Fields you change: branch.');
      expect(developer).toContain('change only the task you were delegated');
      expect(developer).toContain('is in the `board-requests` skill, written for your role');
      expect(developer).not.toContain('<artifact_create');
    });

    it('should show each role the writes it may make', () => {
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
