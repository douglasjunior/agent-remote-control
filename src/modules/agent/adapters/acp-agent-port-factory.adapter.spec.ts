import { describe, expect, it } from 'vitest';

import type { IFileSystemPort } from '../ports/file-system.port.js';
import type { IProcessRunnerPort } from '../ports/process-runner.port.js';

import { AcpAgentPortFactoryAdapter } from './acp-agent-port-factory.adapter.js';
import { AntigravityAdapter } from './antigravity.adapter.js';
import { ClaudeCodeAdapter } from './claude-code.adapter.js';
import { CodexAdapter } from './codex.adapter.js';
import { CopilotAdapter } from './copilot.adapter.js';
import { CursorAdapter } from './cursor.adapter.js';


describe('AcpAgentPortFactoryAdapter', () => {
  const factory = new AcpAgentPortFactoryAdapter({} as IFileSystemPort, {} as IProcessRunnerPort);

  it('should list every supported agent', () => {
    expect(factory.listAgents()).toEqual([
      { agentId: 'agy', displayName: 'Antigravity' },
      { agentId: 'claude', displayName: 'Claude Code' },
      { agentId: 'copilot', displayName: 'GitHub Copilot' },
      { agentId: 'codex', displayName: 'OpenAI Codex' },
      { agentId: 'cursor', displayName: 'Cursor' },
    ]);
  });

  it('should default to a listed agent', () => {
    expect(factory.listAgents().map(agent => agent.agentId)).toContain(factory.defaultAgentId);
  });

  it.each([
    ['agy', AntigravityAdapter],
    ['claude', ClaudeCodeAdapter],
    ['copilot', CopilotAdapter],
    ['codex', CodexAdapter],
    ['cursor', CursorAdapter],
  ])('should create the %s adapter', (agentId, adapterClass) => {
    expect(factory.create(agentId)).toBeInstanceOf(adapterClass);
  });

  it('should create ports whose agent name is the listed agent id', () => {
    for (const { agentId } of factory.listAgents()) {
      expect(factory.create(agentId).agentName).toBe(agentId);
    }
  });

  it('should create a new port on every call', () => {
    expect(factory.create('claude')).not.toBe(factory.create('claude'));
  });

  it('should reject an unknown agent', () => {
    expect(() => factory.create('gpt')).toThrow('Unknown agent "gpt". Available agents: agy, claude, copilot, codex, cursor.');
  });
});
