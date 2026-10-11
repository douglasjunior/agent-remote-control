import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IFileSystemPort } from '../ports/file-system.port.js';
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

function fileSystemStub(
  overrides: {
    resolvedInPath?: string | null;
    readableFiles?: readonly string[];
  } = {},
): IFileSystemPort {
  const readableSet = new Set(overrides.readableFiles ?? []);
  return {
    resolveInPath: vi.fn().mockReturnValue(overrides.resolvedInPath ?? null),
    isReadableFile: vi
      .fn()
      .mockImplementation((path: string) => readableSet.has(path)),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    deleteFile: vi.fn(),
    exists: vi.fn(),
    createDirectory: vi.fn(),
  } as unknown as IFileSystemPort;
}

function buildAdapter(
  fileSystem: IFileSystemPort = fileSystemStub(),
  preferredConfig?: { modelId?: string },
) {
  const { runner, spawn } = createProcessRunnerMock();
  return {
    adapter: new AntigravityAdapter(fileSystem, runner, preferredConfig),
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
    it('should spawn the source bridge via node when dist bridge is not readable', async () => {
      const { adapter, spawn } = buildAdapter(fileSystemStub());

      await adapter.connect();

      expect(acpHarness.spawnedProcs).toHaveLength(1);
      expect(spawn).toHaveBeenCalledWith(
        process.execPath,
        [expect.stringContaining('agy-acp-bridge.ts')],
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
      );
      expect(acpHarness.connectionInstance?.initialize).toHaveBeenCalledWith({
        protocolVersion: 'mock-protocol-version',
        clientCapabilities: {},
      });
    });

    it('should spawn the dist bridge via node when nested dist bridge is readable', async () => {
      const fs = fileSystemStub();
      vi.mocked(fs.isReadableFile).mockImplementation((path: string) =>
        path.includes('bridges/agy-acp-bridge.js'));
      const { runner, spawn: distSpawn } = createProcessRunnerMock();
      const distAdapter = new AntigravityAdapter(fs, runner);

      await distAdapter.connect();

      expect(distSpawn).toHaveBeenCalledWith(
        process.execPath,
        [expect.stringContaining('agy-acp-bridge.js')],
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
      );
    });

    it('should spawn the flat dist bridge when nested is not readable but flat is readable', async () => {
      const fs = fileSystemStub();
      vi.mocked(fs.isReadableFile).mockImplementation((path: string) =>
        path.endsWith('adapters/agy-acp-bridge.js'));
      const { runner, spawn: distSpawn } = createProcessRunnerMock();
      const distAdapter = new AntigravityAdapter(fs, runner);

      await distAdapter.connect();

      expect(distSpawn).toHaveBeenCalledWith(
        process.execPath,
        [expect.stringContaining('agy-acp-bridge.js')],
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
      );
    });

    it('should support preferredConfig when passed', async () => {
      const { adapter } = buildAdapter(fileSystemStub(), { modelId: 'gpt-5' });
      await adapter.connect();
      expect(acpHarness.spawnedProcs).toHaveLength(1);
    });

    it('should spawn the bridge outside the host application directory', async () => {
      const { adapter, spawn } = buildAdapter(fileSystemStub());

      await adapter.connect();

      expect(spawnOptions(spawn)?.cwd).toBe(tmpdir());
    });
  });

  describe('bridge environment isolation', () => {
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

    it('should withhold host credentials and configuration from the bridge', async () => {
      const { adapter, spawn } = buildAdapter(fileSystemStub());

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
      const { adapter, spawn } = buildAdapter(fileSystemStub());

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

    it('should point PWD at the directory the bridge runs in', async () => {
      const { adapter, spawn } = buildAdapter(fileSystemStub());

      await adapter.connect();

      const options = spawnOptions(spawn);
      expect(options?.env?.PWD).toBe(tmpdir());
      expect(options?.env?.PWD).toBe(options?.cwd);
    });

    it('should preserve unrelated variables the agent needs', async () => {
      process.env.SSH_AUTH_SOCK = '/tmp/ssh-agent.socket';
      const { adapter, spawn } = buildAdapter(fileSystemStub());

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
