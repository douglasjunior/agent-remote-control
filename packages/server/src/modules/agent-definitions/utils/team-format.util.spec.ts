import { describe, expect, it } from 'vitest';

import type { AgentDefinition } from '../models/agent-definition.model.js';
import type { AgentRole } from '../models/agent-role.type.js';

import { formatArtifactUse, formatDelegationForms, formatProjectAccess, formatSessionMode } from './team-format.util.js';


function agent(overrides: Partial<AgentDefinition>): AgentDefinition {
  return {
    role: 'AGENT' as AgentRole,
    name: 'Agent',
    description: 'Does things.',
    buildSystemPrompt: () => 'prompt',
    delegation: {},
    artifacts: { scope: 'task', sections: [], fields: [] },
    ...overrides,
  };
}

describe('team-format.util', () => {
  it('should add the artifact attribute to the forms of agents that take one', () => {
    expect(formatDelegationForms(agent({ delegation: { project: 'required', artifact: 'required' } }))).toBe(
      '<delegate role="AGENT" summary="<summary>" artifact="<task id>">',
    );
    expect(formatDelegationForms(agent({ delegation: { project: 'optional', artifact: 'optional' }, artifacts: { scope: 'tree', sections: [], fields: [] } }))).toBe(
      '<delegate role="AGENT" summary="<summary>" artifact="<artifact id>"> or <delegate role="AGENT" summary="<summary>"> or <delegate role="AGENT" summary="<summary>" project="<project-folder>">',
    );
  });

  it('should describe how an agent uses the artifacts of the board', () => {
    expect(formatArtifactUse(agent({ delegation: {} }))).toBe('Takes no artifact.');
    expect(formatArtifactUse(agent({ delegation: { artifact: 'required', needsReviewableWork: true } }))).toBe(
      'Always works on a task of the board and runs in its project. The task must already have work to inspect: a linked pull request or a recorded branch.',
    );
    expect(formatArtifactUse(agent({ delegation: { artifact: 'optional' }, artifacts: { scope: 'tree', sections: [], fields: [] } }))).toBe(
      'May work on a task or a feature of the board, then running in its project.',
    );
  });

  it('should list the delegate tag forms allowed by the project contract', () => {
    expect(formatDelegationForms(agent({ delegation: {} }))).toBe('<delegate role="AGENT" summary="<summary>">');
    expect(formatDelegationForms(agent({ delegation: { project: 'optional' } }))).toBe(
      '<delegate role="AGENT" summary="<summary>"> or <delegate role="AGENT" summary="<summary>" project="<project-folder>">',
    );
    expect(formatDelegationForms(agent({ delegation: { project: 'required' } }))).toBe(
      '<delegate role="AGENT" summary="<summary>" project="<project-folder>">',
    );
  });

  it('should tell read-only agents apart from agents that modify files', () => {
    expect(formatProjectAccess(agent({ delegation: { readOnly: true } }))).toBe(
      'Read-only, so it may work alongside an agent that modifies the same project.',
    );
    expect(formatProjectAccess(agent({}))).toBe(
      'Modifies files, so no other agent that modifies files may work in the same project folder at the same time.',
    );
  });

  it('should describe an overridable session mode with its default', () => {
    expect(formatSessionMode(agent({ delegation: { sessionMode: 'overridable' } }))).toBe(
      'Runs in "resume" session mode unless you set session="new" or session="resume".',
    );
  });

  it('should forbid a session mode override when the mode is fixed', () => {
    expect(formatSessionMode(agent({ defaultSessionMode: 'new' }))).toBe(
      'Always runs in "new" session mode, so never set the session attribute.',
    );
  });
});
