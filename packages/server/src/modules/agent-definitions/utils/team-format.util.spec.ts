import { describe, expect, it } from 'vitest';

import type { AgentDefinition } from '../models/agent-definition.model.js';
import type { AgentRole } from '../models/agent-role.type.js';

import { formatDelegationForms } from './team-format.util.js';


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

  it('should list the delegate tag forms allowed by the project contract', () => {
    expect(formatDelegationForms(agent({ delegation: {} }))).toBe('<delegate role="AGENT" summary="<summary>">');
    expect(formatDelegationForms(agent({ delegation: { project: 'optional' } }))).toBe(
      '<delegate role="AGENT" summary="<summary>"> or <delegate role="AGENT" summary="<summary>" project="<project-folder>">',
    );
    expect(formatDelegationForms(agent({ delegation: { project: 'required' } }))).toBe(
      '<delegate role="AGENT" summary="<summary>" project="<project-folder>">',
    );
  });
});
