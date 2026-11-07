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

  describe('skill listing budget', () => {
    it('should raise the characters Copilot keeps for the skill listing', async () => {
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      expect(spawnCall(spawn).options.env?.SKILL_CHAR_BUDGET).toBe('100000');
    });

    it('should keep a budget the user already set', async () => {
      process.env.SKILL_CHAR_BUDGET = '20000';
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      expect(spawnCall(spawn).options.env?.SKILL_CHAR_BUDGET).toBe('20000');
      delete process.env.SKILL_CHAR_BUDGET;
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

    describe('user output', () => {
      const sample = {
        copilot_plan: 'individual',
        quota_reset_date_utc: '2026-11-01T00:00:00.000Z',
        quota_snapshots: {
          chat: { quota_id: 'chat', unlimited: true, percent_remaining: 100 },
          premium_interactions: {
            quota_id: 'premium_interactions',
            unlimited: false,
            percent_remaining: 50.6,
            remaining: 760,
            entitlement: 1500,
          },
          custom_thing: { percent_remaining: 10 },
          broken: { unlimited: false },
        },
      };

      const quotaOf = async (output: string) => {
        const { runner, adapter } = buildAdapterWithRunner();
        vi.mocked(runner.run).mockResolvedValue({ exitCode: 0, output });
        return adapter.getQuota();
      };

      it('should map limited snapshots to monthly buckets', async () => {
        expect(await quotaOf(JSON.stringify(sample))).toEqual({
          groups: [
            {
              name: 'GitHub Copilot',
              description: 'Plan: individual',
              buckets: [
                {
                  id: 'premium_interactions',
                  name: 'Premium Requests Remaining',
                  window: 'monthly',
                  remainingFraction: 0.506,
                  resetTime: '2026-11-01T00:00:00.000Z',
                  description: '760 of 1500 remaining',
                },
                {
                  id: 'custom_thing',
                  name: 'Custom Thing Remaining',
                  window: 'monthly',
                  remainingFraction: 0.1,
                  resetTime: '2026-11-01T00:00:00.000Z',
                  description: undefined,
                },
              ],
            },
          ],
        });
      });

      it('should omit plan and reset time when absent', async () => {
        const quota = await quotaOf(JSON.stringify({ quota_snapshots: { a: { percent_remaining: 5 } } }));

        expect(quota?.groups[0]?.description).toBeUndefined();
        expect(quota?.groups[0]?.buckets[0]?.resetTime).toBeUndefined();
      });

      it.each(['not json', 'null', '{}'])('should return undefined for the payload %s', async (output) => {
        expect(await quotaOf(output)).toBeUndefined();
      });
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
