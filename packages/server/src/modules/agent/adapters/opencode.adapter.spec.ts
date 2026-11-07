import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acpHarness,
  createProcessRunnerMock,
  resetAcpHarness,
} from '../testing/acp-adapter-test-harness.js';

import { OpenCodeAdapter } from './opencode.adapter.js';


vi.mock('node:stream', async () =>
  (await import('../testing/acp-adapter-test-harness.js')).streamMockModule());
vi.mock('@agentclientprotocol/sdk', async () =>
  (await import('../testing/acp-adapter-test-harness.js')).acpSdkMockModule());

function buildAdapter(preferredConfig?: { modelId?: string }) {
  const { runner, spawn } = createProcessRunnerMock();
  return { adapter: new OpenCodeAdapter(runner, preferredConfig), spawn };
}

function spawnCall(spawn: ReturnType<typeof createProcessRunnerMock>['spawn']) {
  const [command, args, options] = spawn.mock.calls[0] ?? [];
  return {
    command,
    args: args as readonly string[],
    options: options as { cwd?: string; env?: NodeJS.ProcessEnv },
  };
}

describe('OpenCodeAdapter', () => {
  beforeEach(() => {
    resetAcpHarness();
  });

  it('should identify itself as the opencode agent', () => {
    expect(buildAdapter().adapter.agentName).toBe('opencode');
  });

  it('should run the opencode CLI in ACP mode', async () => {
    const { adapter, spawn } = buildAdapter();

    await adapter.connect();

    const { command, args } = spawnCall(spawn);
    expect(command).toBe('opencode');
    expect(args).toEqual(['acp']);
    expect(acpHarness.spawnedProcs).toHaveLength(1);
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

  it('should accept a preferred configuration', async () => {
    const { adapter } = buildAdapter({ modelId: 'opencode/big-pickle' });

    await expect(adapter.connect()).resolves.toBeUndefined();
  });

  it('should not expose a quota', async () => {
    await expect(buildAdapter().adapter.getQuota()).resolves.toBeUndefined();
  });
});
