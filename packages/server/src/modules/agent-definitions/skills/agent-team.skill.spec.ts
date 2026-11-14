import { describe, expect, it } from 'vitest';


import { GIT_OPS_ARTIFACT_ACCESS } from '../constants/artifact-access.constant.js';
import type { AgentDefinition } from '../models/agent-definition.model.js';
import { skillContext } from '../testing/skill-context.fixture.js';

import { AGENT_TEAM_SKILL } from './agent-team.skill.js';


const WORKSPACE_DIR = '/home/user/workspaces';

const gitOps: AgentDefinition = {
  role: 'GIT_OPS',
  name: 'Git Ops Agent',
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
