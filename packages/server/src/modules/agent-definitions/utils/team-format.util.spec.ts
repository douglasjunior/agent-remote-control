import { describe, expect, it } from '@rstest/core';

import type { AgentDefinition } from '../models/agent-definition.model.js';
import type { AgentRole } from '../models/agent-role.type.js';

import { formatDelegationForms, formatDelegationTargets } from './team-format.util.js';


function agent(overrides: Partial<AgentDefinition>): AgentDefinition {
  return {
    role: 'AGENT' as AgentRole,
    name: 'Agent',
    summary: 'Does things.',
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

  it('should add the form with session="new" for an agent that takes an artifact and a session mode', () => {
    expect(formatDelegationForms(agent({ delegation: { project: 'required', sessionMode: 'overridable', artifact: 'required' } }))).toBe(
      '<delegate role="AGENT" summary="<summary>" artifact="<task id>"> or <delegate role="AGENT" summary="<summary>" artifact="<task id>" session="new">',
    );
    expect(formatDelegationForms(agent({ delegation: { project: 'optional', sessionMode: 'overridable', artifact: 'optional' }, artifacts: { scope: 'tree', sections: [], fields: [] } }))).toBe(
      '<delegate role="AGENT" summary="<summary>" artifact="<artifact id>"> or <delegate role="AGENT" summary="<summary>" artifact="<artifact id>" session="new">'
      + ' or <delegate role="AGENT" summary="<summary>"> or <delegate role="AGENT" summary="<summary>" project="<project-folder>">',
    );
  });

  it('should not show the session attribute for an agent that takes no artifact', () => {
    expect(formatDelegationForms(agent({ delegation: { project: 'optional', sessionMode: 'overridable' } }))).toBe(
      '<delegate role="AGENT" summary="<summary>"> or <delegate role="AGENT" summary="<summary>" project="<project-folder>">',
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

  describe('formatDelegationTargets', () => {
    const treeAccess = { scope: 'tree', sections: [], fields: [] } as const;

    it('should name only the artifact for an agent that always takes one', () => {
      expect(formatDelegationTargets(agent({ delegation: { project: 'required', artifact: 'required' } }))).toBe('with `artifact` (a task)');
      expect(formatDelegationTargets(agent({ delegation: { artifact: 'required' }, artifacts: treeAccess }))).toBe('with `artifact` (a task or a feature)');
    });

    it('should name the artifact, the project and neither for an agent that takes any of them', () => {
      expect(formatDelegationTargets(agent({ delegation: { project: 'optional', artifact: 'optional' }, artifacts: treeAccess }))).toBe(
        'with `artifact` (a task or a feature), with `project` or with neither',
      );
      expect(formatDelegationTargets(agent({ delegation: { project: 'optional', artifact: 'optional' } }))).toBe(
        'with `artifact` (a task), with `project` or with neither',
      );
    });

    it('should join the artifact and neither when the agent takes no project', () => {
      expect(formatDelegationTargets(agent({ delegation: { artifact: 'optional' } }))).toBe('with `artifact` (a task) or with neither');
    });

    it('should leave out the artifact for an agent that takes none', () => {
      expect(formatDelegationTargets(agent({ delegation: { project: 'optional' } }))).toBe('with `project` or with neither');
      expect(formatDelegationTargets(agent({ delegation: { project: 'required' } }))).toBe('with `project`');
      expect(formatDelegationTargets(agent({ delegation: {} }))).toBe('with neither');
    });
  });
});
