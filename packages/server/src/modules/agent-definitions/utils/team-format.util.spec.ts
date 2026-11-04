import { describe, expect, it } from 'vitest';

import type { AgentDefinition } from '../models/agent-definition.model.js';
import type { AgentRole } from '../models/agent-role.type.js';

import { formatDelegationForms, formatProjectAccess, formatSessionMode } from './team-format.util.js';


function agent(overrides: Partial<AgentDefinition>): AgentDefinition {
  return {
    role: 'AGENT' as AgentRole,
    name: 'Agent',
    description: 'Does things.',
    buildSystemPrompt: () => 'prompt',
    delegation: {},
    ...overrides,
  };
}

describe('team-format.util', () => {
  it('should list the delegate tag forms allowed by the project contract', () => {
    expect(formatDelegationForms(agent({ delegation: {} }))).toBe('<delegate role="AGENT">');
    expect(formatDelegationForms(agent({ delegation: { project: 'optional' } }))).toBe(
      '<delegate role="AGENT"> or <delegate role="AGENT" project="<project-folder>">',
    );
    expect(formatDelegationForms(agent({ delegation: { project: 'required' } }))).toBe(
      '<delegate role="AGENT" project="<project-folder>">',
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
