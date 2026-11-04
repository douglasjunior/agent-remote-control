import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IFileSystemPort } from '../ports/file-system.port.js';
import {
  acpHarness,
  createProcessRunnerMock,
  modelConfigOption,
  resetAcpHarness,
} from '../testing/acp-adapter-test-harness.js';

import { CursorAdapter } from './cursor.adapter.js';


vi.mock('node:stream', async () =>
  (await import('../testing/acp-adapter-test-harness.js')).streamMockModule());
vi.mock('@agentclientprotocol/sdk', async () =>
  (await import('../testing/acp-adapter-test-harness.js')).acpSdkMockModule());

function fileSystemStub(binariesInPath: readonly string[] = []): IFileSystemPort {
  return {
    resolveInPath: vi.fn((binary: string) => (binariesInPath.includes(binary) ? `/usr/bin/${binary}` : null)),
  } as unknown as IFileSystemPort;
}

function buildAdapter(fileSystem: IFileSystemPort = fileSystemStub(['cursor-agent'])) {
  const { runner, spawn } = createProcessRunnerMock();
  return { adapter: new CursorAdapter(fileSystem, runner), spawn };
}

function spawnCall(spawn: ReturnType<typeof createProcessRunnerMock>['spawn']) {
  const [command, args, options] = spawn.mock.calls[0] ?? [];
  return {
    command,
    args: args as readonly string[],
    options: options as { cwd?: string; env?: NodeJS.ProcessEnv },
  };
}

describe('CursorAdapter', () => {
  beforeEach(() => {
    resetAcpHarness();
  });

  it('should identify itself as the cursor agent', () => {
    expect(buildAdapter().adapter.agentName).toBe('cursor');
  });

  describe('spawnAgentProcess', () => {
    it('should run the Cursor CLI in ACP mode with every interactive approval turned off', async () => {
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      const { command, args, options } = spawnCall(spawn);
      expect(command).toBe('cursor-agent');
      expect(args).toEqual(['--force', '--sandbox', 'disabled', '--trust', '--approve-mcps', 'acp']);
      expect(options).toMatchObject({ cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    });

    it('should fall back to the agent binary when only it is installed', async () => {
      const { adapter, spawn } = buildAdapter(fileSystemStub(['agent']));

      await adapter.connect();

      expect(spawnCall(spawn).command).toBe('agent');
    });

    it('should try cursor-agent when no Cursor binary is in PATH', async () => {
      const { adapter, spawn } = buildAdapter(fileSystemStub());

      await adapter.connect();

      expect(spawnCall(spawn).command).toBe('cursor-agent');
    });

    it('should withhold host credentials from the agent', async () => {
      process.env.DISCORD_BOT_TOKEN = 'bot-token';
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      expect(spawnCall(spawn).options.env?.DISCORD_BOT_TOKEN).toBeUndefined();
      delete process.env.DISCORD_BOT_TOKEN;
    });
  });

  describe('blocking Cursor requests', () => {
    it('should send a question back to the final response', async () => {
      const { adapter } = buildAdapter();
      await adapter.connect();

      const result = await acpHarness.lastClient?.extensionRequest('cursor/ask_question', { question: 'Which DB?' });

      expect(result).toEqual({
        outcome: { outcome: 'skipped', reason: expect.stringContaining('Write your question in your final response with the <question> tags') },
      });
    });

    it('should decline plan approval and keep the agent working', async () => {
      const { adapter } = buildAdapter();
      await adapter.connect();

      const result = await acpHarness.lastClient?.extensionRequest('cursor/create_plan', { plan: [] });

      expect(result).toEqual({
        outcome: { outcome: 'rejected', reason: expect.stringContaining('Carry out the task') },
      });
    });
  });

  describe('models', () => {
    it('should show the reasoning level encoded in the model id', async () => {
      const { adapter } = buildAdapter();
      await adapter.connect();
      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [
          modelConfigOption({
            currentValue: 'default[]',
            options: [
              { value: 'default[]', name: 'Auto' },
              { value: 'claude-opus-5[thinking=true,context=300k,effort=high,fast=false]', name: 'claude-opus-5' },
              { value: 'gpt-5[reasoning=medium,fast=true]', name: 'gpt-5' },
              { value: 'composer[fast=false]', name: 'composer' },
              { value: 'plain-model', name: 'Plain', description: 'No params' },
            ],
          }),
        ],
      });

      await adapter.createSession('/repo');

      expect(adapter.getAvailableModels()?.availableModels).toEqual([
        { modelId: 'default[]', name: 'Auto', displayName: 'Auto', description: undefined },
        {
          modelId: 'claude-opus-5[thinking=true,context=300k,effort=high,fast=false]',
          name: 'claude-opus-5 (high)',
          displayName: 'claude-opus-5 (high)',
          description: 'thinking=true, context=300k, effort=high, fast=false',
        },
        {
          modelId: 'gpt-5[reasoning=medium,fast=true]',
          name: 'gpt-5 (medium, fast)',
          displayName: 'gpt-5 (medium, fast)',
          description: 'reasoning=medium, fast=true',
        },
        { modelId: 'composer[fast=false]', name: 'composer', displayName: 'composer', description: 'fast=false' },
        { modelId: 'plain-model', name: 'Plain', displayName: 'Plain', description: 'No params' },
      ]);
    });
  });
});
