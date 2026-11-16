import { describe, expect, it } from '@rstest/core';

import { buildAgentResult } from './agent-result.prompt.js';


describe('agent-result.prompt', () => {
  it('should wrap the output with the role alone when nothing else is known', () => {
    expect(buildAgentResult('GIT_OPS', undefined, 'Cloned.')).toBe('<agent_result role="GIT_OPS">\nCloned.\n</agent_result>');
  });

  it('should name the project, the artifact and its status, the agent that ran it and how it ended', () => {
    expect(buildAgentResult('DEVELOPER', 'shop', 'Stopped.', {
      artifactId: 'T-1',
      artifactStatus: 'cancelled',
      artifactStatusByUser: true,
      agentInfo: { roleName: 'Developer', agentName: 'Codex "cli"' },
      status: 'stopped',
    })).toBe('<agent_result role="DEVELOPER" project="shop" artifact="T-1" artifact_status="cancelled" artifact_status_by="user" agent="Codex &quot;cli&quot;" model="default" effort="default" status="stopped">\nStopped.\n</agent_result>');
  });

  it('should leave out a status nobody read', () => {
    expect(buildAgentResult('QA', 'shop', 'Done.', { artifactId: 'T-2' })).toBe('<agent_result role="QA" project="shop" artifact="T-2">\nDone.\n</agent_result>');
  });
});
