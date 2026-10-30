import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IFileSystemPort } from '../ports/file-system.port.js';
import {
  acpHarness,
  createProcessRunnerMock,
  resetAcpHarness,
} from '../testing/acp-adapter-test-harness.js';

import { CodexAdapter } from './codex.adapter.js';


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
  return { adapter: new CodexAdapter(fileSystem, runner), spawn, runner };
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

describe('CodexAdapter', () => {
  const originalEnv = { CODEX_PATH: process.env.CODEX_PATH, CODEX_CONFIG: process.env.CODEX_CONFIG };

  beforeEach(() => {
    resetAcpHarness();
    delete process.env.CODEX_PATH;
    delete process.env.CODEX_CONFIG;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('should identify itself as the codex agent', () => {
    expect(buildAdapter().adapter.agentName).toBe('codex');
  });

  describe('spawnAgentProcess', () => {
    it('should run the installed codex-acp bridge with the current Node.js', async () => {
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      const { command, args } = spawnCall(spawn);
      expect(command).toBe(process.execPath);
      expect(args).toHaveLength(1);
      expect(args[0]).toMatch(/@agentclientprotocol[/\\]codex-acp[/\\]dist[/\\]index\.js$/);
      expect(existsSync(args[0]!)).toBe(true);
    });

    it('should run outside the host application directory without host credentials', async () => {
      process.env.DISCORD_BOT_TOKEN = 'bot-token';
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      const { options } = spawnCall(spawn);
      expect(options).toMatchObject({ cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
      expect(options.env?.DISCORD_BOT_TOKEN).toBeUndefined();
      delete process.env.DISCORD_BOT_TOKEN;
    });
  });

  describe('Codex executable', () => {
    it('should point the bridge at the codex CLI found in PATH', async () => {
      const { adapter, spawn } = buildAdapter(fileSystemStub('/usr/local/bin/codex'));

      await adapter.connect();

      expect(spawnCall(spawn).options.env?.CODEX_PATH).toBe('/usr/local/bin/codex');
    });

    it('should keep an executable the user already set', async () => {
      process.env.CODEX_PATH = '/opt/codex';
      const { adapter, spawn } = buildAdapter(fileSystemStub('/usr/local/bin/codex'));

      await adapter.connect();

      expect(spawnCall(spawn).options.env?.CODEX_PATH).toBe('/opt/codex');
    });

    it('should let the bridge use its bundled binary when codex is not in PATH', async () => {
      const { adapter, spawn } = buildAdapter(fileSystemStub(null));

      await adapter.connect();

      expect(spawnCall(spawn).options.env?.CODEX_PATH).toBeUndefined();
    });
  });

  describe('skill listing budget', () => {
    const codexConfig = (spawn: ReturnType<typeof createProcessRunnerMock>['spawn']) =>
      JSON.parse(spawnCall(spawn).options.env?.CODEX_CONFIG ?? '{}') as Record<string, unknown>;

    it('should raise the tokens Codex keeps for the skill listing to its maximum', async () => {
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      expect(codexConfig(spawn)).toEqual({ 'skills.max_context_tokens': 10_000 });
    });

    it('should merge the user config over the budget', async () => {
      process.env.CODEX_CONFIG = JSON.stringify({ 'skills.max_context_tokens': 4000, model: 'gpt-5' });
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      expect(codexConfig(spawn)).toEqual({ 'skills.max_context_tokens': 4000, model: 'gpt-5' });
    });

    it.each([['not json'], ['[1, 2]'], ['null']])('should ignore a user config that is not a JSON object: %s', async (config) => {
      process.env.CODEX_CONFIG = config;
      const { adapter, spawn } = buildAdapter();

      await adapter.connect();

      expect(codexConfig(spawn)).toEqual({ 'skills.max_context_tokens': 10_000 });
    });
  });

  describe('session mode', () => {
    it('should run new sessions in full access mode', async () => {
      const { adapter } = buildAdapter();
      await adapter.connect();
      acpHarness.connectionInstance?.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [modeConfigOption('agent', ['read-only', 'agent', 'agent-full-access'])],
      });

      await adapter.createSession('/repo');

      expect(acpHarness.connectionInstance?.setSessionConfigOption).toHaveBeenCalledWith({
        sessionId: 'session-1',
        configId: 'mode',
        value: 'agent-full-access',
      });
    });
  });

  describe('getQuota', () => {
    const rateLimits = {
      rateLimits: {
        primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_793_413_800 },
      },
    };

    function fakeAppServer(reply: (request: { id?: number; method: string }) => string | undefined) {
      const proc = new EventEmitter() as EventEmitter & {
        stdin: { write: ReturnType<typeof vi.fn> };
        stdout: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.kill = vi.fn();
      proc.stdin = {
        write: vi.fn((line: string) => {
          const response = reply(JSON.parse(line));
          if (response !== undefined) {
            queueMicrotask(() => proc.stdout.emit('data', Buffer.from(response)));
          }
        }),
      };
      return proc;
    }

    const respond = (result: object) => (request: { id?: number; method: string }) => {
      if (request.method === 'initialize') return `${JSON.stringify({ id: 1, result: {} })}\n`;
      if (request.method === 'account/rateLimits/read') {
        return `not json\nnull\n${JSON.stringify({ id: 7 })}\n${JSON.stringify({ id: 2, ...result })}\n`;
      }
      return undefined;
    };

    it('should read the rate limits from codex app-server', async () => {
      const { adapter, spawn } = buildAdapter(fileSystemStub('/usr/bin/codex'));
      const proc = fakeAppServer(respond({ result: rateLimits }));
      spawn.mockReturnValueOnce(proc as never);

      const quota = await adapter.getQuota();

      expect(spawn.mock.calls[0]?.[0]).toBe('/usr/bin/codex');
      expect(spawn.mock.calls[0]?.[1]).toEqual(['app-server']);
      expect(proc.stdin.write.mock.calls.map(([line]) => JSON.parse(line).method)).toEqual([
        'initialize',
        'initialized',
        'account/rateLimits/read',
      ]);
      expect(quota?.groups[0]?.buckets[0]).toMatchObject({ id: 'primary', remainingFraction: 0.75 });
      expect(proc.kill).toHaveBeenCalled();
    });

    it('should prefer CODEX_PATH over the PATH lookup', async () => {
      vi.stubEnv('CODEX_PATH', '/opt/codex');
      const { adapter, spawn } = buildAdapter(fileSystemStub('/usr/bin/codex'));
      spawn.mockReturnValueOnce(fakeAppServer(respond({ result: rateLimits })) as never);

      await adapter.getQuota();

      expect(spawn.mock.calls[0]?.[0]).toBe('/opt/codex');
      vi.unstubAllEnvs();
    });

    it('should return undefined when codex is not installed', async () => {
      vi.stubEnv('CODEX_PATH', '');
      const { adapter, spawn } = buildAdapter();

      expect(await adapter.getQuota()).toBeUndefined();
      expect(spawn).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });

    it('should return undefined when the server answers with an error', async () => {
      const { adapter, spawn } = buildAdapter(fileSystemStub('/usr/bin/codex'));
      const proc = fakeAppServer(respond({ error: { message: 'no auth' } }));
      spawn.mockReturnValueOnce(proc as never);

      expect(await adapter.getQuota()).toBeUndefined();
      expect(proc.kill).toHaveBeenCalled();
    });

    it('should return undefined when the server exits or fails to start', async () => {
      const { adapter, spawn } = buildAdapter(fileSystemStub('/usr/bin/codex'));
      const exiting = fakeAppServer(() => undefined);
      spawn.mockReturnValueOnce(exiting as never);
      const pending = adapter.getQuota();
      exiting.emit('exit');
      expect(await pending).toBeUndefined();

      const failing = fakeAppServer(() => undefined);
      spawn.mockReturnValueOnce(failing as never);
      const failed = adapter.getQuota();
      failing.emit('error', new Error('ENOENT'));
      expect(await failed).toBeUndefined();

      spawn.mockImplementationOnce(() => {
        throw 'x';
      });
      expect(await adapter.getQuota()).toBeUndefined();
    });

    it('should give up when the server does not answer in time', async () => {
      vi.useFakeTimers();
      const { adapter, spawn } = buildAdapter(fileSystemStub('/usr/bin/codex'));
      const proc = fakeAppServer(() => undefined);
      spawn.mockReturnValueOnce(proc as never);

      const pending = adapter.getQuota();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(await pending).toBeUndefined();
      expect(proc.kill).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
});
