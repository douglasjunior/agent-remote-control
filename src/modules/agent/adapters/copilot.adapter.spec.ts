import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acpHarness,
  createProcessRunnerMock,
  resetAcpHarness,
} from '../testing/acp-adapter-test-harness.js';

import { CopilotAdapter } from './copilot.adapter.js';


vi.mock('node:stream', async () =>
  (await import('../testing/acp-adapter-test-harness.js')).streamMockModule());
vi.mock('@agentclientprotocol/sdk', async () =>
  (await import('../testing/acp-adapter-test-harness.js')).acpSdkMockModule());

function buildAdapter() {
  const { runner, spawn } = createProcessRunnerMock();
  return { adapter: new CopilotAdapter(runner), spawn };
}

function buildAdapterWithRunner() {
  const { runner } = createProcessRunnerMock();
  return { runner, adapter: new CopilotAdapter(runner) };
}

function spawnCall(spawn: ReturnType<typeof createProcessRunnerMock>['spawn']) {
  const [command, args, options] = spawn.mock.calls[0] ?? [];
  return {
    command,
    args: args as readonly string[],
    options: options as { cwd?: string; env?: NodeJS.ProcessEnv },
  };
}

function permissionsConfigOption(currentValue: string, values: readonly string[]) {
  return {
    id: 'permissions',
    type: 'select' as const,
    name: 'Permissions',
    category: 'permissions',
    currentValue,
    options: values.map(value => ({ value, name: value })),
  };
}

describe('CopilotAdapter', () => {
  beforeEach(() => {
    resetAcpHarness();
  });

  it('should identify itself as the copilot agent', () => {
    expect(buildAdapter().adapter.agentName).toBe('copilot');
  });

  describe('spawnAgentProcess', () => {
    it('should run the copilot CLI in ACP mode over stdio', async () => {
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      const { command, args } = spawnCall(spawn);
      expect(command).toBe('copilot');
      expect(args).toEqual(['--acp', '--stdio']);
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

  describe('tool autonomy', () => {
    it('should turn tool autonomy on for new sessions', async () => {
      const { adapter } = buildAdapter();
      await adapter.connect();
      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [permissionsConfigOption('off', ['off', 'on'])],
      });

      await adapter.createSession('/repo');

      expect(acpHarness.connectionInstance?.setSessionConfigOption).toHaveBeenCalledWith({
        sessionId: 'session-1',
        configId: 'permissions',
        value: 'on',
      });
    });

    it('should restore tool autonomy on a loaded session', async () => {
      const { adapter } = buildAdapter();
      acpHarness.pendingConnectionOverrides = {
        initialize: vi.fn(async () => ({ agentCapabilities: { loadSession: true } })),
        loadSession: vi.fn(async () => ({
          configOptions: [permissionsConfigOption('off', ['off', 'on'])],
        })),
      };
      await adapter.connect();

      await expect(adapter.loadSession('/repo', 'copilot-session')).resolves.toBe(true);

      expect(acpHarness.connectionInstance?.setSessionConfigOption).toHaveBeenCalledWith({
        sessionId: 'copilot-session',
        configId: 'permissions',
        value: 'on',
      });
    });

    it('should keep the session when the agent does not publish tool autonomy', async () => {
      const { adapter } = buildAdapter();
      await adapter.connect();
      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [],
      });

      await adapter.createSession('/repo');

      expect(adapter.currentSessionId).toBe('session-1');
      expect(acpHarness.connectionInstance?.setSessionConfigOption).not.toHaveBeenCalled();
    });
  });

  describe('getQuota', () => {
    const payload = JSON.stringify({
      quota_snapshots: { premium_interactions: { percent_remaining: 50 } },
    });

    it('should run gh api and return the parsed quota', async () => {
      const { runner, adapter } = buildAdapterWithRunner();
      vi.mocked(runner.run).mockResolvedValue({ exitCode: 0, output: payload });

      const quota = await adapter.getQuota();

      expect(runner.run).toHaveBeenCalledWith('gh', ['api', '/copilot_internal/user']);
      expect(quota?.groups[0]?.buckets[0]?.remainingFraction).toBe(0.5);
    });

    it('should return undefined on non-zero exit code', async () => {
      const { runner, adapter } = buildAdapterWithRunner();
      vi.mocked(runner.run).mockResolvedValue({ exitCode: 1, output: payload });

      expect(await adapter.getQuota()).toBeUndefined();
    });

    it('should return undefined when the runner throws', async () => {
      const { runner, adapter } = buildAdapterWithRunner();
      vi.mocked(runner.run).mockRejectedValue(new Error('boom'));
      expect(await adapter.getQuota()).toBeUndefined();

      vi.mocked(runner.run).mockRejectedValue('x');
      expect(await adapter.getQuota()).toBeUndefined();
    });
  });
});
