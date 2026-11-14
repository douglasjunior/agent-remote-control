import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acpHarness,
  createProcessRunnerMock,
  modelConfigOption,
  resetAcpHarness,
} from '../testing/acp-adapter-test-harness.js';
import { StubFileSystem } from '../testing/stub-file-system.port.js';
import { StubProcessRunner } from '../testing/stub-process-runner.port.js';

import { CursorAdapter } from './cursor.adapter.js';


vi.mock('node:stream', async () =>
  (await import('../testing/acp-adapter-test-harness.js')).streamMockModule());
vi.mock('@agentclientprotocol/sdk', async () =>
  (await import('../testing/acp-adapter-test-harness.js')).acpSdkMockModule());

function fileSystemStub(binariesInPath: readonly string[] = []): StubFileSystem {
  const fileSystem = new StubFileSystem();
  binariesInPath.forEach(binary => fileSystem.addBinary(binary));
  return fileSystem;
}

function buildAdapter(fileSystem: StubFileSystem = fileSystemStub(['cursor-agent'])) {
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

describe('CursorAdapter quota', () => {
  const realPlatform = process.platform;

  const jwt = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
  const DAY = 86_400_000;
  const start = Date.UTC(2026, 10, 1);
  const usage = (overrides: object = {}) => ({
    billingCycleStart: String(start),
    billingCycleEnd: String(start + 30 * DAY),
    planUsage: { totalPercentUsed: 40, autoPercentUsed: 10, apiPercentUsed: 120 },
    ...overrides,
  });

  let fetchMock: ReturnType<typeof vi.fn>;
  let runner: StubProcessRunner;
  let fileSystem: StubFileSystem;

  const setPlatform = (platform: NodeJS.Platform) => Object.defineProperty(process, 'platform', { value: platform });
  const respond = (body: unknown, status = 200) => fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body });
  const quota = () => new CursorAdapter(fileSystem, runner).getQuota();

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    runner = new StubProcessRunner();
    fileSystem = new StubFileSystem();
    setPlatform('linux');
    vi.stubEnv('CURSOR_AUTH_TOKEN', '');
    vi.stubEnv('CURSOR_API_ENDPOINT', '');
    vi.stubEnv('AGENT_CLI_CREDENTIAL_STORE', '');
    vi.stubEnv('XDG_CONFIG_HOME', '/xdg');
    vi.stubEnv('APPDATA', '');
  });

  afterEach(() => {
    setPlatform(realPlatform);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('reads the plan usage with the token of the environment and maps the monthly cycle', async () => {
    vi.stubEnv('CURSOR_AUTH_TOKEN', ' token ');
    vi.stubEnv('CURSOR_API_ENDPOINT', 'https://cursor.example/');
    respond(usage());

    expect(await quota()).toEqual({
      groups: [
        {
          name: 'Cursor',
          buckets: [
            { id: 'included', name: 'Included usage', window: 'monthly', remainingFraction: 0.6, resetTime: new Date(start + 30 * DAY).toISOString(), description: 'Usage included in the plan' },
            { id: 'auto', name: 'Auto', window: 'monthly', remainingFraction: 0.9, resetTime: new Date(start + 30 * DAY).toISOString() },
            { id: 'api', name: 'API', window: 'monthly', remainingFraction: 0, resetTime: new Date(start + 30 * DAY).toISOString() },
          ],
        },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://cursor.example/aiserver.v1.DashboardService/GetCurrentPeriodUsage');
    expect(init).toMatchObject({ method: 'POST', body: '{}' });
    expect(init.headers.authorization).toBe('Bearer token');
  });

  it.each([
    [1, 'daily'],
    [7, 'weekly'],
    [3, 'cycle'],
  ])('names a cycle of %d days %s', async (days, window) => {
    vi.stubEnv('CURSOR_AUTH_TOKEN', 'token');
    respond(usage({ billingCycleEnd: start + days * DAY }));

    expect((await quota())?.groups[0]?.buckets[0]?.window).toBe(window);
  });

  it('derives the included usage from the spend without a percent, and reads a cycle without dates', async () => {
    vi.stubEnv('CURSOR_AUTH_TOKEN', 'token');
    respond({ planUsage: { limit: '2000', includedSpend: '500' } });

    const [included, auto] = (await quota())!.groups[0]!.buckets;

    expect(included).toEqual({ id: 'included', name: 'Included usage', window: 'cycle', remainingFraction: 0.75, description: 'Usage included in the plan' });
    expect(auto).toEqual({ id: 'auto', name: 'Auto', window: 'cycle', remainingFraction: 1 });
  });

  it('counts nothing used when the plan reports neither percent nor spend', async () => {
    vi.stubEnv('CURSOR_AUTH_TOKEN', 'token');
    respond({ planUsage: {} });

    expect((await quota())?.groups[0]?.buckets[0]?.remainingFraction).toBe(1);
  });

  it.each([
    ['a plan without usage', { billingCycleStart: '1' }, 200],
    ['an unexpected payload', { planUsage: { totalPercentUsed: 'x' } }, 200],
    ['a refused token', {}, 401],
  ])('reports no quota for %s', async (_name, body, status) => {
    vi.stubEnv('CURSOR_AUTH_TOKEN', 'token');
    respond(body, status);

    expect(await quota()).toBeUndefined();
  });

  it.each([new Error('offline'), 'offline'])('reports no quota when the request fails (%#)', async (failure) => {
    vi.stubEnv('CURSOR_AUTH_TOKEN', 'token');
    fetchMock.mockRejectedValue(failure);

    expect(await quota()).toBeUndefined();
  });

  it('never sends an expired token, and sends one it cannot read the expiry of', async () => {
    vi.stubEnv('CURSOR_AUTH_TOKEN', jwt({ exp: 1 }));
    expect(await quota()).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();

    respond(usage());
    for (const token of [jwt({ exp: Math.floor(Date.now() / 1000) + 3600 }), jwt({}), 'h.!!!.s']) {
      vi.stubEnv('CURSOR_AUTH_TOKEN', token);
      expect(await quota()).toBeDefined();
    }
  });

  it('reads the token from the macOS Keychain, and has none when it is missing', async () => {
    setPlatform('darwin');
    runner.runResult = async () => ({ exitCode: 0, output: 'keychain-token\n' });
    respond(usage());

    expect(await quota()).toBeDefined();
    expect(runner.runs[0]).toMatchObject({ command: '/usr/bin/security', args: ['find-generic-password', '-a', 'cursor-user', '-s', 'cursor-access-token', '-w'] });
    expect((fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }).headers.authorization).toBe('Bearer keychain-token');

    runner.runResult = async () => ({ exitCode: 44, output: '' });
    expect(await quota()).toBeUndefined();
    runner.runResult = async () => ({ exitCode: 0, output: '  ' });
    expect(await quota()).toBeUndefined();
  });

  it.each([
    ['darwin', 'file', '/.cursor/auth.json'],
    ['linux', '', '/xdg/cursor/auth.json'],
    ['win32', '', '/AppData/Roaming/Cursor/auth.json'],
  ] as const)('reads the token from the auth file on %s with store %j', async (platform, store, suffix) => {
    setPlatform(platform);
    vi.stubEnv('AGENT_CLI_CREDENTIAL_STORE', store);
    fileSystem.text = JSON.stringify({ accessToken: ' file-token ' });
    respond(usage());

    expect(await quota()).toBeDefined();
    expect(fileSystem.reads[0]?.endsWith(suffix)).toBe(true);
  });

  it('takes the auth file from APPDATA and XDG defaults', async () => {
    fileSystem.text = JSON.stringify({ accessToken: 'file-token' });
    respond(usage());
    setPlatform('win32');
    vi.stubEnv('APPDATA', '/appdata');
    await quota();
    setPlatform('linux');
    vi.stubEnv('XDG_CONFIG_HOME', '');
    await quota();

    expect(fileSystem.reads).toEqual(['/appdata/Cursor/auth.json', expect.stringMatching(/\/\.config\/cursor\/auth\.json$/)]);
  });

  it.each([
    ['a memory store on macOS', 'darwin', 'memory', 'ignored'],
    ['a missing auth file', 'linux', '', null],
    ['an auth file that is not JSON', 'linux', '', '{'],
    ['an auth file without a token', 'linux', '', '{"token":"x"}'],
    ['an auth file with a blank token', 'linux', '', '{"accessToken":"  "}'],
  ] as const)('has no token with %s', async (_name, platform, store, text) => {
    setPlatform(platform);
    vi.stubEnv('AGENT_CLI_CREDENTIAL_STORE', store);
    fileSystem.text = text;

    expect(await quota()).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
