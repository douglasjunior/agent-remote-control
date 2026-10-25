import { describe, expect, it } from 'vitest';

import type { AgentDefinition } from '../models/agent-definition.model.js';
import type { AgentRole } from '../models/agent-role.type.js';

import { formatDelegationForms, formatSessionMode } from './team-format.util.js';


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
  it('should list the marker forms allowed by the project contract', () => {
    expect(formatDelegationForms(agent({ delegation: {} }))).toBe('[DELEGATE:AGENT]');
    expect(formatDelegationForms(agent({ delegation: { project: 'optional' } }))).toBe(
      '[DELEGATE:AGENT] or [DELEGATE:AGENT:<project-folder>]',
    );
    expect(formatDelegationForms(agent({ delegation: { project: 'required' } }))).toBe(
      '[DELEGATE:AGENT:<project-folder>]',
    );
  });

  it('should describe an overridable session mode with its default', () => {
    expect(formatSessionMode(agent({ delegation: { sessionMode: 'overridable' } }))).toBe(
      'Runs in "resume" session mode unless you append :new or :resume.',
    );
  });

  it('should forbid a session mode override when the mode is fixed', () => {
    expect(formatSessionMode(agent({ defaultSessionMode: 'new' }))).toBe(
      'Always runs in "new" session mode, so never append :new or :resume.',
    );
  });
});
