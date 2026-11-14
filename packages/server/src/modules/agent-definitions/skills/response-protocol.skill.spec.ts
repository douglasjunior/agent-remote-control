import { describe, expect, it } from 'vitest';

import { skillContext } from '../testing/skill-context.fixture.js';

import { RESPONSE_PROTOCOL_SKILL } from './response-protocol.skill.js';


const WORKSPACE_DIR = '/home/user/workspaces';

describe('response-protocol skill', () => {
  const skill = RESPONSE_PROTOCOL_SKILL.buildContent(skillContext({ workspaceDir: WORKSPACE_DIR }));

  it('should be read by the CEO only', () => {
    expect(RESPONSE_PROTOCOL_SKILL).toMatchObject({ name: 'response-protocol', roles: ['CEO'] });
  });

  it('should explain attachments with absolute paths converted from agent reports', () => {
    expect(skill).toContain(`<attachment path="${WORKSPACE_DIR}/my-app/docs/report.pdf">Report</attachment>`);
    expect(skill).toContain(`becomes \`${WORKSPACE_DIR}/my-app/docs/report.pdf\``);
    expect(skill).toContain('only in an answer, never in a response that delegates');
  });

  it('should list questions to the user as an outcome that continues the turn', () => {
    expect(skill).toContain('- **Questions**: one or more `<question>` tags');
    expect(skill).toContain('Never combine questions with delegations or attachments.');
    expect(skill).toContain('## Questions to the User\nWhen the work cannot go on without a decision only the user can make');
  });

  it('should cover every pending request and report each agent result', () => {
    expect(skill).toContain('the final answer covers each pending request');
    expect(skill).toContain('each `<agent_result>` is reported even when a newer message moved the conversation on');
  });
});
