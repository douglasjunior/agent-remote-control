import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acpHarness,
  createProcessRunnerMock,
  resetAcpHarness,
} from '../testing/acp-adapter-test-harness.js';
import { AntigravityAdapter } from './antigravity.adapter.js';
import type { IFileSystemPort } from '../ports/file-system.port.js';

vi.mock('node:stream', async () =>
  (await import('../testing/acp-adapter-test-harness.js')).streamMockModule(),
);
vi.mock('@agentclientprotocol/sdk', async () =>
  (await import('../testing/acp-adapter-test-harness.js')).acpSdkMockModule(),
);

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
  return spawn.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv } | undefined;
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
        path.includes('bridges/agy-acp-bridge.js'),
      );
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
        path.endsWith('adapters/agy-acp-bridge.js'),
      );
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
  });

  describe('AGY_PATH injection', () => {
    const originalAgyPath = process.env.AGY_PATH;

    beforeEach(() => {
      delete process.env.AGY_PATH;
    });

    afterEach(() => {
      if (originalAgyPath === undefined) {
        delete process.env.AGY_PATH;
      } else {
        process.env.AGY_PATH = originalAgyPath;
      }
    });

    it('should inject the detected agy path so the bridge uses the real install', async () => {
      const { adapter, spawn } = buildAdapter(
        fileSystemStub({ resolvedInPath: '/usr/local/bin/agy' }),
      );

      await adapter.connect();

      expect(spawnOptions(spawn)?.env?.AGY_PATH).toBe('/usr/local/bin/agy');
    });

    it('should preserve an AGY_PATH already set in the environment', async () => {
      process.env.AGY_PATH = '/custom/bin/agy';
      const fileSystem = fileSystemStub({
        resolvedInPath: '/usr/local/bin/agy',
      });
      const { adapter, spawn } = buildAdapter(fileSystem);

      await adapter.connect();

      expect(spawnOptions(spawn)?.env?.AGY_PATH).toBe('/custom/bin/agy');
      expect(fileSystem.resolveInPath).not.toHaveBeenCalled();
    });

    it('should not set AGY_PATH when agy is not found in PATH', async () => {
      const { adapter, spawn } = buildAdapter(
        fileSystemStub({ resolvedInPath: null }),
      );

      await adapter.connect();

      expect(spawnOptions(spawn)?.env?.AGY_PATH).toBeUndefined();
    });
  });
});
