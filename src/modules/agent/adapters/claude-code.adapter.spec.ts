import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IFileSystemPort } from '../ports/file-system.port.js';
import {
  acpHarness,
  createProcessRunnerMock,
  resetAcpHarness,
} from '../testing/acp-adapter-test-harness.js';

import { ClaudeCodeAdapter } from './claude-code.adapter.js';


vi.mock('node:stream', async () =>
  (await import('../testing/acp-adapter-test-harness.js')).streamMockModule());
vi.mock('@agentclientprotocol/sdk', async () =>
  (await import('../testing/acp-adapter-test-harness.js')).acpSdkMockModule());

function fileSystemStub(resolvedInPath: string | null = null): IFileSystemPort {
  return {
    resolveInPath: vi.fn().mockReturnValue(resolvedInPath),
  } as unknown as IFileSystemPort;
}

function buildAdapter(fileSystem: IFileSystemPort = fileSystemStub()) {
  const { runner, spawn } = createProcessRunnerMock();
  return { adapter: new ClaudeCodeAdapter(fileSystem, runner), spawn, runner };
}

function spawnCall(spawn: ReturnType<typeof createProcessRunnerMock>['spawn']) {
  const [command, args, options] = spawn.mock.calls[0] ?? [];
  return {
    command,
    args: args as readonly string[],
    options: options as { cwd?: string; env?: NodeJS.ProcessEnv },
  };
}

function modeConfigOption(currentValue: string, values: readonly string[]) {
  return {
    id: 'mode',
    type: 'select' as const,
    name: 'Mode',
    category: 'mode',
    currentValue,
    options: values.map(value => ({ value, name: value })),
  };
}

describe('ClaudeCodeAdapter', () => {
  const originalExecutable = process.env.CLAUDE_CODE_EXECUTABLE;

  beforeEach(() => {
    resetAcpHarness();
    delete process.env.CLAUDE_CODE_EXECUTABLE;
  });

  afterEach(() => {
    if (originalExecutable === undefined) {
      delete process.env.CLAUDE_CODE_EXECUTABLE;
    } else {
      process.env.CLAUDE_CODE_EXECUTABLE = originalExecutable;
    }
  });

  it('should identify itself as the claude agent', () => {
    expect(buildAdapter().adapter.agentName).toBe('claude');
  });

  describe('spawnAgentProcess', () => {
    it('should run the installed claude-agent-acp entry point with node', async () => {
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      const { command, args } = spawnCall(spawn);
      expect(command).toBe(process.execPath);
      expect(args).toHaveLength(1);
      expect(args[0]).toMatch(/@agentclientprotocol[/\\]claude-agent-acp[/\\]dist[/\\]index\.js$/);
      expect(existsSync(args[0]!)).toBe(true);
    });

    it('should run outside the host application directory with piped stdio', async () => {
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      const { options } = spawnCall(spawn);
      expect(options).toMatchObject({ cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
      expect(options.env?.PWD).toBe(tmpdir());
    });

    it('should withhold host credentials from the agent', async () => {
      process.env.DISCORD_BOT_TOKEN = 'bot-token';
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      expect(spawnCall(spawn).options.env?.DISCORD_BOT_TOKEN).toBeUndefined();
      delete process.env.DISCORD_BOT_TOKEN;
    });
  });

  describe('skill listing budget', () => {
    it('should raise the characters Claude Code keeps for the skill listing', async () => {
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      expect(spawnCall(spawn).options.env?.SLASH_COMMAND_TOOL_CHAR_BUDGET).toBe('100000');
    });

    it('should keep a budget the user already set', async () => {
      process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET = '20000';
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      expect(spawnCall(spawn).options.env?.SLASH_COMMAND_TOOL_CHAR_BUDGET).toBe('20000');
      delete process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET;
    });
  });

  describe('Claude Code executable', () => {
    it('should point the agent at the claude CLI found in PATH', async () => {
      const { adapter, spawn } = buildAdapter(fileSystemStub('/usr/local/bin/claude'));

      await adapter.connect();

      expect(spawnCall(spawn).options.env?.CLAUDE_CODE_EXECUTABLE).toBe('/usr/local/bin/claude');
    });

    it('should prefer the claude CLI in PATH over an executable inherited from the environment', async () => {
      process.env.CLAUDE_CODE_EXECUTABLE = '/custom/bin/claude';
      const { adapter, spawn } = buildAdapter(fileSystemStub('/usr/local/bin/claude'));

      await adapter.connect();

      expect(spawnCall(spawn).options.env?.CLAUDE_CODE_EXECUTABLE).toBe('/usr/local/bin/claude');
    });

    it('should let the agent use its bundled binary when claude is not in PATH', async () => {
      process.env.CLAUDE_CODE_EXECUTABLE = '/custom/bin/claude';
      const { adapter, spawn } = buildAdapter(fileSystemStub(null));

      await adapter.connect();

      expect(spawnCall(spawn).options.env?.CLAUDE_CODE_EXECUTABLE).toBeUndefined();
    });
  });

  describe('permission mode', () => {
    it('should run new sessions with bypassPermissions', async () => {
      const { adapter } = buildAdapter();
      await adapter.connect();
      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [modeConfigOption('auto', ['default', 'auto', 'bypassPermissions'])],
      });

      await adapter.createSession('/repo');

      expect(acpHarness.connectionInstance?.setSessionConfigOption).toHaveBeenCalledWith({
        sessionId: 'session-1',
        configId: 'mode',
        value: 'bypassPermissions',
      });
    });

    it('should restore bypassPermissions on a loaded session', async () => {
      const { adapter } = buildAdapter();
      acpHarness.pendingConnectionOverrides = {
        initialize: vi.fn(async () => ({ agentCapabilities: { loadSession: true } })),
        loadSession: vi.fn(async () => ({
          configOptions: [modeConfigOption('auto', ['auto', 'bypassPermissions'])],
        })),
      };
      await adapter.connect();

      await expect(adapter.loadSession('/repo', 'claude-session')).resolves.toBe(true);

      expect(acpHarness.connectionInstance?.setSessionConfigOption).toHaveBeenCalledWith({
        sessionId: 'claude-session',
        configId: 'mode',
        value: 'bypassPermissions',
      });
    });

    it('should keep the session when the agent does not offer bypassPermissions', async () => {
      const { adapter } = buildAdapter();
      await adapter.connect();
      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [modeConfigOption('default', ['default', 'auto'])],
      });

      await adapter.createSession('/repo');

      expect(adapter.currentSessionId).toBe('session-1');
      expect(acpHarness.connectionInstance?.setSessionConfigOption).not.toHaveBeenCalled();
    });
  });

  describe('getQuota', () => {
    const output = 'Current session: 9% used · resets Oct 30, 11:29pm (UTC)\n';

    it('should run claude /usage and return the parsed quota', async () => {
      const { adapter, runner } = buildAdapter();
      vi.mocked(runner.run).mockResolvedValue({ exitCode: 0, output });

      const quota = await adapter.getQuota();

      expect(runner.run).toHaveBeenCalledWith('claude', ['-p', '/usage']);
      expect(quota?.groups[0]?.buckets[0]).toMatchObject({
        id: 'current-session',
        window: '5h',
        remainingFraction: 0.91,
      });
    });

    it('should return undefined on non-zero exit code', async () => {
      const { adapter, runner } = buildAdapter();
      vi.mocked(runner.run).mockResolvedValue({ exitCode: 1, output });

      expect(await adapter.getQuota()).toBeUndefined();
    });

    it('should return undefined when the runner throws', async () => {
      const { adapter, runner } = buildAdapter();
      vi.mocked(runner.run).mockRejectedValue(new Error('boom'));
      expect(await adapter.getQuota()).toBeUndefined();

      vi.mocked(runner.run).mockRejectedValue('x');
      expect(await adapter.getQuota()).toBeUndefined();
    });
  });
});
