import { describe, expect, it } from '@rstest/core';


import { GIT_OPS_ARTIFACT_ACCESS } from '../constants/artifact-access.constant.js';
import type { AgentDefinition } from '../models/agent-definition.model.js';
import { skillContext } from '../testing/skill-context.fixture.js';

import { AGENT_TEAM_SKILL } from './agent-team.skill.js';


const WORKSPACE_DIR = '/home/user/workspaces';

const gitOps: AgentDefinition = {
  role: 'GIT_OPS',
  name: 'Git Ops Agent',
  summary: 'Administers repositories.',
  description: 'Adds repositories to the workspace.',
  buildSystemPrompt: () => 'git',
  delegation: { project: 'optional', sessionMode: 'overridable' },
  artifacts: GIT_OPS_ARTIFACT_ACCESS,
};

describe('agent-team skill', () => {
  const skill = AGENT_TEAM_SKILL.buildContent(skillContext({ team: [gitOps], workspaceDir: WORKSPACE_DIR }));

  it('should be read by the CEO only', () => {
    expect(AGENT_TEAM_SKILL).toMatchObject({ name: 'agent-team', roles: ['CEO'] });
  });

  it('should describe every team member with its delegate tag forms and session mode', () => {
    expect(skill).toContain('### GIT_OPS — Git Ops Agent\nAdds repositories to the workspace.');
    expect(skill).toContain('- Delegate as <delegate role="GIT_OPS" summary="<summary>"> or <delegate role="GIT_OPS" summary="<summary>" project="<project-folder>">.');
    expect(skill).toContain('- Runs in "resume" session mode unless you set session="new" or session="resume".');
    expect(skill).toContain('- Modifies files, so no other agent that modifies files');
    expect(skill).toContain('- Never asks the user: a decision it needs comes back in its result, for you to take to the user.');
  });

  it('should tell which agents ask the user directly', () => {
    const owner = { ...gitOps, role: 'PRODUCT_OWNER' as const, delegation: { ...gitOps.delegation, asksUser: true as const } };

    expect(AGENT_TEAM_SKILL.buildContent(skillContext({ team: [owner] }))).toContain('- Asks the user directly for the decisions it needs while it works.');
  });

  it('should tell which agents are delegated to only on the user\'s decision', () => {
    const support = { ...gitOps, role: 'IT_SUPPORT' as const, delegation: { ...gitOps.delegation, userInitiatedOnly: true as const } };

    expect(AGENT_TEAM_SKILL.buildContent(skillContext({ team: [support] }))).toContain('- Delegate to it only on the user\'s decision: suggest it with a `<question>`');
    expect(skill).not.toContain('only on the user\'s decision');
  });

  it('should describe how each agent uses the board, its project and its session', () => {
    const contentFor = (overrides: Partial<AgentDefinition>) => AGENT_TEAM_SKILL.buildContent(skillContext({ team: [{ ...gitOps, ...overrides }] }));

    expect(skill).toContain('- Takes no artifact.');
    expect(contentFor({ delegation: { artifact: 'required', needsReviewableWork: true }, artifacts: { scope: 'task', sections: [], fields: [] } })).toContain(
      '- Always works on a task of the board and runs in its project. The task must already have work to inspect: a linked pull request or a recorded branch.',
    );
    expect(contentFor({ delegation: { artifact: 'optional' }, artifacts: { scope: 'tree', sections: [], fields: [] } })).toContain(
      '- May work on a task or a feature of the board, then running in its project.',
    );
    expect(contentFor({ delegation: { readOnly: true } })).toContain('- Read-only, so it may work alongside an agent that modifies the same project.');
    expect(contentFor({ delegation: {}, defaultSessionMode: 'new' })).toContain('- Always runs in "new" session mode, so never set the session attribute.');
  });

  describe('session mode', () => {
    const sessionLine = (overrides: Partial<AgentDefinition>) =>
      AGENT_TEAM_SKILL.buildContent(skillContext({ team: [{ ...gitOps, ...overrides }] })).split('\n').find(line => /session/.test(line) && line.startsWith('- '));

    it('should keep one session per task for an agent that always works on one, whether or not the mode is overridable', () => {
      const line = '- Keeps one session per task: a new task starts with a clean context and the same task continues where it left off.';

      expect(sessionLine({ delegation: { artifact: 'required' } })).toBe(line);
      expect(sessionLine({ delegation: { artifact: 'required', sessionMode: 'overridable' } })).toBe(line);
    });

    it('should keep one session per artifact and let the mode be set without one when the session is overridable', () => {
      expect(sessionLine({ delegation: { artifact: 'optional', sessionMode: 'overridable' }, defaultSessionMode: 'new' })).toBe(
        '- Keeps one session per artifact it is delegated; without an artifact it runs in "new" session mode unless you set session="new" or session="resume".',
      );
    });

    it('should keep one session per artifact and fix the mode without one when the session is not overridable', () => {
      expect(sessionLine({ delegation: { artifact: 'optional' } })).toBe(
        '- Keeps one session per artifact it is delegated; without an artifact it always runs in "resume" session mode, so never set the session attribute.',
      );
    });

    it('should state the mode alone for an agent that takes no artifact', () => {
      expect(sessionLine({ delegation: { sessionMode: 'overridable' } })).toBe('- Runs in "resume" session mode unless you set session="new" or session="resume".');
      expect(sessionLine({ delegation: {} })).toBe('- Always runs in "resume" session mode, so never set the session attribute.');
    });
  });

  it('should put discovery before technical planning and keep requirement interviews with the agents', () => {
    expect(skill).toContain('discovery of what to build before technical planning');
    expect(skill).toContain('Different items, and phases that do not depend on each other, overlap across roles');
    expect(skill).toContain('Do not interview the user about requirements yourself');
  });

  it('should state that no agent is available when the team is empty', () => {
    expect(AGENT_TEAM_SKILL.buildContent(skillContext({ workspaceDir: WORKSPACE_DIR }))).toContain('No agents are available for delegation.');
  });
});
