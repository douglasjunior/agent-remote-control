import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acpHarness,
  createProcessRunnerMock,
  resetAcpHarness,
} from '../testing/acp-adapter-test-harness.js';

import { AntigravityAdapter } from './antigravity.adapter.js';


vi.mock('node:stream', async () =>
  (await import('../testing/acp-adapter-test-harness.js')).streamMockModule());
vi.mock('@agentclientprotocol/sdk', async () =>
  (await import('../testing/acp-adapter-test-harness.js')).acpSdkMockModule());

function buildAdapter(preferredConfig?: { modelId?: string }) {
  const { runner, spawn } = createProcessRunnerMock();
  return {
    adapter: new AntigravityAdapter(runner, preferredConfig),
    spawn,
    runner,
  };
}

function spawnOptions(
  spawn: ReturnType<typeof createProcessRunnerMock>['spawn'],
) {
  return spawn.mock.calls[0]?.[2] as
    | { cwd?: string; env?: NodeJS.ProcessEnv }
    | undefined;
}

describe('AntigravityAdapter', () => {
  beforeEach(() => {
    resetAcpHarness();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('spawnAgentProcess', () => {
    it('should run the native agy ACP server with a worker per session and permissions auto-approved', async () => {
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      expect(acpHarness.spawnedProcs).toHaveLength(1);
      expect(spawn).toHaveBeenCalledWith(
        'agy',
        ['acp', '--process-per-session', '--dangerously-skip-permissions'],
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
      );
      expect(acpHarness.connectionInstance?.initialize).toHaveBeenCalledWith({
        protocolVersion: 'mock-protocol-version',
        clientCapabilities: { session: { notices: {} } },
      });
    });

    it('should support preferredConfig when passed', async () => {
      const { adapter } = buildAdapter({ modelId: 'gemini-3.8-flash' });

      await expect(adapter.connect()).resolves.toBeUndefined();
    });

    it('should spawn agy outside the host application directory', async () => {
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      expect(spawnOptions(spawn)?.cwd).toBe(tmpdir());
    });
  });

  describe('agent environment isolation', () => {
    const hostVariables = {
      DISCORD_BOT_TOKEN: 'bot-token',
      DISCORD_GUILD_ID: 'guild-id',
      WORKSPACE_DIR: '/home/user/workspaces',
      DATA_DIR: '/home/user/data',
      SESSION_IDLE_TIMEOUT_MS: '1800000',
      PORT: '3000',
      PWD: '/home/user/projects/host-app',
      OLDPWD: '/home/user/projects/host-app',
      INIT_CWD: '/home/user/projects/host-app',
      PROJECT_CWD: '/home/user/projects/host-app',
      npm_package_name: 'host-app',
      npm_package_json: '/home/user/projects/host-app/package.json',
    };
    const originals = new Map<string, string | undefined>();

    beforeEach(() => {
      for (const [key, value] of Object.entries(hostVariables)) {
        originals.set(key, process.env[key]);
        process.env[key] = value;
      }
    });

    afterEach(() => {
      for (const [key, value] of originals) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      originals.clear();
    });

    it('should withhold host credentials and configuration from the agent', async () => {
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      const env = spawnOptions(spawn)?.env ?? {};
      expect(env.DISCORD_BOT_TOKEN).toBeUndefined();
      expect(env.DISCORD_GUILD_ID).toBeUndefined();
      expect(env.WORKSPACE_DIR).toBeUndefined();
      expect(env.DATA_DIR).toBeUndefined();
      expect(env.SESSION_IDLE_TIMEOUT_MS).toBeUndefined();
      expect(env.PORT).toBeUndefined();
    });

    it('should withhold every variable that reveals the host application directory', async () => {
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      const env = spawnOptions(spawn)?.env ?? {};
      expect(env.OLDPWD).toBeUndefined();
      expect(env.INIT_CWD).toBeUndefined();
      expect(env.PROJECT_CWD).toBeUndefined();
      expect(
        Object.keys(env).filter(key => key.startsWith('npm_')),
      ).toEqual([]);
      expect(
        Object.values(env).filter(value =>
          value?.includes('/home/user/projects/host-app')),
      ).toEqual([]);
    });

    it('should point PWD at the directory the agent runs in', async () => {
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      const options = spawnOptions(spawn);
      expect(options?.env?.PWD).toBe(tmpdir());
      expect(options?.env?.PWD).toBe(options?.cwd);
    });

    it('should preserve unrelated variables the agent needs', async () => {
      process.env.SSH_AUTH_SOCK = '/tmp/ssh-agent.socket';
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      const env = spawnOptions(spawn)?.env ?? {};
      expect(env.SSH_AUTH_SOCK).toBe('/tmp/ssh-agent.socket');
      expect(env.PATH).toBe(process.env.PATH);

      delete process.env.SSH_AUTH_SOCK;
    });
  });

  describe('getQuota', () => {
    const payload = JSON.stringify({
      status: 'SUCCESS',
      command: {
        name: 'usage',
        data: {
          groups: [
            {
              name: 'Gemini Models',
              buckets: [
                {
                  id: 'gemini-5h',
                  name: 'Five Hour Limit Remaining',
                  window: '5h',
                  remaining_fraction: 0.5,
                  reset_time: '2026-10-11T23:03:22Z',
                },
              ],
            },
          ],
        },
      },
    });

    it('should run agy /usage and return the parsed quota', async () => {
      const { adapter, runner } = buildAdapter();
      vi.mocked(runner.run).mockResolvedValue({ exitCode: 0, output: payload });

      const quota = await adapter.getQuota();

      expect(runner.run).toHaveBeenCalledWith('agy', [
        '--output-format',
        'json',
        '--print',
        '/usage',
      ]);
      expect(quota?.groups[0]?.buckets[0]).toMatchObject({
        id: 'gemini-5h',
        window: '5h',
        remainingFraction: 0.5,
      });
    });

    describe('usage output', () => {
      const sample = {
        conversation_id: '',
        status: 'SUCCESS',
        response: 'text',
        command: {
          name: 'usage',
          data: {
            description: 'Shared limits',
            groups: [
              {
                name: 'Gemini Models',
                description: 'Gemini Flash, Gemini Pro',
                buckets: [
                  {
                    id: 'gemini-weekly',
                    name: 'Weekly Limit Remaining',
                    description: 'resets soon',
                    window: 'weekly',
                    remaining_fraction: 0.94,
                    reset_time: '2026-10-12T23:32:42Z',
                  },
                  { id: 'bad', name: 'Missing fields' },
                ],
              },
              { description: 'no name' },
              { name: 'No buckets' },
            ],
          },
        },
      };

      const quotaOf = async (output: string) => {
        const { adapter, runner } = buildAdapter();
        vi.mocked(runner.run).mockResolvedValue({ exitCode: 0, output });
        return adapter.getQuota();
      };

      it('should map groups and buckets into the standard quota shape', async () => {
        expect(await quotaOf(JSON.stringify(sample))).toEqual({
          description: 'Shared limits',
          groups: [
            {
              name: 'Gemini Models',
              description: 'Gemini Flash, Gemini Pro',
              buckets: [
                {
                  id: 'gemini-weekly',
                  name: 'Weekly Limit Remaining',
                  description: 'resets soon',
                  window: 'weekly',
                  remainingFraction: 0.94,
                  resetTime: '2026-10-12T23:32:42Z',
                },
              ],
            },
          ],
        });
      });

      it('should ignore log noise around the JSON document', async () => {
        const quota = await quotaOf(`warn: x\n${JSON.stringify(sample)}\ntrailing`);

        expect(quota?.groups).toHaveLength(1);
      });

      it('should return undefined for invalid or unsuccessful payloads', async () => {
        expect(await quotaOf('no json')).toBeUndefined();
        expect(await quotaOf('{ not json }')).toBeUndefined();
        expect(await quotaOf(JSON.stringify({ ...sample, status: 'ERROR' }))).toBeUndefined();
        expect(await quotaOf(JSON.stringify({ status: 'SUCCESS' }))).toBeUndefined();
      });
    });

    it('should return undefined on non-zero exit code', async () => {
      const { adapter, runner } = buildAdapter();
      vi.mocked(runner.run).mockResolvedValue({ exitCode: 1, output: payload });

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
