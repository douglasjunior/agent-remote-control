import { beforeEach, describe, expect, it } from 'vitest';

import type { IFileSystemPort } from '../ports/file-system.port.js';
import type { IProcessRunnerPort } from '../ports/process-runner.port.js';

import { AcpAgentPortFactoryAdapter } from './acp-agent-port-factory.adapter.js';
import { AntigravityAdapter } from './antigravity.adapter.js';
import { ClaudeCodeAdapter } from './claude-code.adapter.js';
import { CodexAdapter } from './codex.adapter.js';
import { CopilotAdapter } from './copilot.adapter.js';
import { CursorAdapter } from './cursor.adapter.js';


class FakeFileSystem {
  readonly binariesInPath = new Set<string>();

  isInPath(binary: string): boolean {
    return this.binariesInPath.has(binary);
  }
}

describe('AcpAgentPortFactoryAdapter', () => {
  let fileSystem: FakeFileSystem;
  let factory: AcpAgentPortFactoryAdapter;

  beforeEach(() => {
    fileSystem = new FakeFileSystem();
    factory = new AcpAgentPortFactoryAdapter(
      fileSystem as unknown as IFileSystemPort,
      {} as IProcessRunnerPort,
    );
  });

  it('should list every supported agent', () => {
    expect(factory.listAgents()).toEqual([
      { agentId: 'agy', displayName: 'Antigravity' },
      { agentId: 'claude', displayName: 'Claude Code' },
      { agentId: 'copilot', displayName: 'GitHub Copilot' },
      { agentId: 'codex', displayName: 'OpenAI Codex' },
      { agentId: 'cursor', displayName: 'Cursor' },
    ]);
  });

  describe('availability', () => {
    it.each([
      ['agy', 'agy'],
      ['claude', 'claude'],
      ['copilot', 'copilot'],
      ['codex', 'codex'],
      ['cursor', 'cursor-agent'],
      ['cursor', 'agent'],
    ])('should offer %s when %s is in the PATH', (agentId, binary) => {
      fileSystem.binariesInPath.add(binary);

      expect(factory.isAgentAvailable(agentId)).toBe(true);
      expect(factory.listAvailableAgents().map(agent => agent.agentId)).toEqual([agentId]);
    });

    it('should offer no agent when no CLI is in the PATH', () => {
      expect(factory.listAvailableAgents()).toEqual([]);
      expect(factory.listAgents()).toHaveLength(5);
      expect(factory.isAgentAvailable('claude')).toBe(false);
    });

    it('should keep the catalog order when listing the available agents', () => {
      fileSystem.binariesInPath.add('codex');
      fileSystem.binariesInPath.add('claude');

      expect(factory.listAvailableAgents()).toEqual([
        { agentId: 'claude', displayName: 'Claude Code' },
        { agentId: 'codex', displayName: 'OpenAI Codex' },
      ]);
    });

    it('should not offer an unknown agent', () => {
      expect(factory.isAgentAvailable('gpt')).toBe(false);
    });

    it('should see an agent installed after the factory was created', () => {
      expect(factory.isAgentAvailable('copilot')).toBe(false);

      fileSystem.binariesInPath.add('copilot');

      expect(factory.isAgentAvailable('copilot')).toBe(true);
    });

    it('should create an agent that is not in the PATH', () => {
      expect(factory.isAgentAvailable('claude')).toBe(false);
      expect(factory.create('claude')).toBeInstanceOf(ClaudeCodeAdapter);
    });
  });

  describe('defaultAgentId', () => {
    it('should be agy when it is available', () => {
      fileSystem.binariesInPath.add('claude');
      fileSystem.binariesInPath.add('agy');

      expect(factory.defaultAgentId).toBe('agy');
    });

    it('should be the first available agent when agy is not installed', () => {
      fileSystem.binariesInPath.add('codex');
      fileSystem.binariesInPath.add('cursor-agent');

      expect(factory.defaultAgentId).toBe('codex');
    });

    it('should be agy when no agent is available', () => {
      expect(factory.defaultAgentId).toBe('agy');
    });
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
