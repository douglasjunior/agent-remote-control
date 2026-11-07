import { tmpdir } from 'node:os';
import { delimiter } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StubAgentPortFactory } from '../../orchestrator/testing/stub-agent-port-factory.js';
import { StubAgentPort } from '../../orchestrator/testing/stub-agent.port.js';
import type { AgentLoginEvent } from '../models/agent-auth.model.js';
import { AgentAuthRequiredError } from '../ports/agent.port.js';
import { AgentAuthConfigService } from '../services/agent-auth-config.service.js';
import { StubFileSystem } from '../testing/stub-file-system.port.js';
import { StubProcessRunner } from '../testing/stub-process-runner.port.js';

import { CliAgentAuthAdapter } from './cli-agent-auth.adapter.js';


const CLAUDE_LOGGED_IN = '{"loggedIn": true, "email": "me@example.com"}';
const CLAUDE_LOGGED_OUT = '{"loggedIn": false}';

function setup() {
  const factory = new StubAgentPortFactory();
  factory.agents = [
    { agentId: 'claude', displayName: 'Claude Code' },
    { agentId: 'codex', displayName: 'OpenAI Codex' },
    { agentId: 'agy', displayName: 'Antigravity' },
    { agentId: 'opencode', displayName: 'OpenCode' },
  ];
  const runner = new StubProcessRunner();
  const fileSystem = new StubFileSystem().addBinary('claude').addBinary('codex').addBinary('agy');
  const adapter = new CliAgentAuthAdapter(factory, runner, fileSystem, new AgentAuthConfigService());
  const events: AgentLoginEvent[] = [];
  return { adapter, factory, runner, fileSystem, events, record: (event: AgentLoginEvent) => events.push(event) };
}

async function flush(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

describe('CliAgentAuthAdapter', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AGENT_AUTH_ENABLED;
    delete process.env.AGENT_AUTH_LOGIN_TIMEOUT_MS;
    delete process.env.AGENT_AUTH_STATUS_TIMEOUT_MS;
  });

  describe('status', () => {
    it('should list only the available agents that have a CLI login', async () => {
      const { adapter, runner } = setup();
      runner.runResult = async command =>
        command === 'claude'
          ? { exitCode: 0, output: CLAUDE_LOGGED_IN }
          : { exitCode: 0, output: 'Logged in using ChatGPT' };

      const infos = await adapter.listAuthInfo();

      expect(infos).toEqual([
        { agentId: 'claude', displayName: 'Claude Code', status: 'authenticated', detail: 'me@example.com' },
        { agentId: 'codex', displayName: 'OpenAI Codex', status: 'authenticated' },
        { agentId: 'agy', displayName: 'Antigravity', status: 'authenticated' },
      ]);
    });

    it('should list nothing when the feature is disabled', async () => {
      process.env.AGENT_AUTH_ENABLED = 'false';
      const { adapter, runner } = setup();

      expect(adapter.isEnabled()).toBe(false);
      await expect(adapter.listAuthInfo()).resolves.toEqual([]);
      expect(runner.runs).toEqual([]);
    });

    it('should leave out agents whose CLI is not installed', async () => {
      const { adapter, factory } = setup();
      factory.unavailableAgentIds.add('claude');
      factory.unavailableAgentIds.add('agy');

      const infos = await adapter.listAuthInfo();

      expect(infos.map(info => info.agentId)).toEqual(['codex']);
    });

    it('should report no status for an agent without a CLI login or that is unavailable', async () => {
      const { adapter, factory } = setup();
      factory.unavailableAgentIds.add('claude');

      await expect(adapter.getStatus('opencode')).resolves.toBeUndefined();
      await expect(adapter.getStatus('claude')).resolves.toBeUndefined();
      await expect(adapter.getStatus('unknown')).resolves.toBeUndefined();
    });

    it('should read a command probe with its own arguments and a timeout signal', async () => {
      const { adapter, runner } = setup();
      runner.runResult = async () => ({ exitCode: 1, output: CLAUDE_LOGGED_OUT });

      const info = await adapter.getStatus('claude');

      expect(info).toEqual({ agentId: 'claude', displayName: 'Claude Code', status: 'unauthenticated' });
      expect(runner.runs).toHaveLength(1);
      expect(runner.runs[0]).toMatchObject({ command: 'claude', args: ['auth', 'status'] });
      expect(runner.runs[0]?.signal).toBeInstanceOf(AbortSignal);
    });

    it('should be unknown when the status binary is missing from the PATH', async () => {
      const { adapter, fileSystem } = setup();
      fileSystem.binaries.delete('claude');
      const factoryAvailable = adapter.getStatus('claude');

      await expect(factoryAvailable).resolves.toMatchObject({ status: 'unknown' });
    });

    it('should be unknown when the status command fails to run', async () => {
      const { adapter, runner } = setup();
      runner.runResult = async () => {
        throw new Error('spawn failed');
      };

      await expect(adapter.getStatus('claude')).resolves.toMatchObject({ status: 'unknown' });
    });

    describe('ACP probe', () => {
      it('should be authenticated when the CLI opens a session', async () => {
        const { adapter, factory } = setup();
        const port = new StubAgentPort();
        factory.agents = [{ agentId: 'agy', displayName: 'Antigravity' }];
        const built = vi.spyOn(factory, 'create').mockReturnValue(port);

        const info = await adapter.getStatus('agy');

        expect(info?.status).toBe('authenticated');
        expect(built).toHaveBeenCalledWith('agy');
        expect(port.createSessionCalls).toEqual([tmpdir()]);
        expect(port.closeSessionCalls).toBe(1);
        expect(port.connected).toBe(false);
      });

      it('should be unauthenticated when the CLI refuses the session for a missing login', async () => {
        const { adapter, factory } = setup();
        const port = new StubAgentPort();
        port.errorToThrowOnCreateSession = new AgentAuthRequiredError('agy', 'Authentication required');
        vi.spyOn(factory, 'create').mockReturnValue(port);

        await expect(adapter.getStatus('agy')).resolves.toMatchObject({ status: 'unauthenticated' });
      });

      it('should be unknown for any other failure', async () => {
        const { adapter, factory } = setup();
        const port = new StubAgentPort();
        port.errorToThrowOnConnect = new Error('binary crashed');
        vi.spyOn(factory, 'create').mockReturnValue(port);

        await expect(adapter.getStatus('agy')).resolves.toMatchObject({ status: 'unknown' });
      });

      it('should be unknown when the probe outlasts the timeout', async () => {
        vi.useFakeTimers();
        process.env.AGENT_AUTH_STATUS_TIMEOUT_MS = '500';
        const { adapter, factory } = setup();
        const port = new StubAgentPort();
        port.connect = () => new Promise<void>(() => undefined);
        vi.spyOn(factory, 'create').mockReturnValue(port);

        const pending = adapter.getStatus('agy');
        await vi.advanceTimersByTimeAsync(500);

        await expect(pending).resolves.toMatchObject({ status: 'unknown' });
      });

      it('should not fail when closing the probe session fails', async () => {
        const { adapter, factory } = setup();
        const port = new StubAgentPort();
        port.closeSession = async () => {
          throw new Error('close failed');
        };
        port.disconnect = async () => {
          throw new Error('disconnect failed');
        };
        vi.spyOn(factory, 'create').mockReturnValue(port);

        await expect(adapter.getStatus('agy')).resolves.toMatchObject({ status: 'authenticated' });
      });
    });
  });

  describe('login', () => {
    it('should refuse to start while the feature is disabled', () => {
      process.env.AGENT_AUTH_ENABLED = 'false';
      const { adapter, record } = setup();

      expect(() => adapter.startLogin('claude', record)).toThrow('Agent authentication is disabled.');
    });

    it('should refuse an agent without a CLI login', () => {
      const { adapter, record } = setup();

      expect(() => adapter.startLogin('opencode', record)).toThrow('Agent "opencode" has no CLI login.');
    });

    it('should refuse an agent whose CLI is not installed', () => {
      const { adapter, fileSystem, record } = setup();
      fileSystem.binaries.delete('claude');

      expect(() => adapter.startLogin('claude', record)).toThrow('The claude CLI was not found in PATH.');
    });

    it('should spawn the login with browsers neutralized and piped stdio', async () => {
      const { adapter, runner, fileSystem, record } = setup();
      process.env.PATH = '/usr/bin';

      adapter.startLogin('claude', record);
      await flush();

      const [spawned] = runner.spawns;
      expect(spawned?.command).toBe('claude');
      expect(spawned?.args).toEqual(['auth', 'login', '--claudeai']);
      const openers = `${tmpdir()}/arc-agent-auth-openers`;
      expect(spawned?.options).toMatchObject({ cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
      expect(spawned?.options?.env?.PATH).toBe(`${openers}${delimiter}/usr/bin`);
      expect(spawned?.options?.env?.BROWSER).toBe(`${openers}/xdg-open`);
      expect(spawned?.options?.env?.NO_OPEN_BROWSER).toBe('1');
      expect(spawned?.options?.env?.PWD).toBe(tmpdir());
      expect([...fileSystem.executables.keys()]).toContain(`${openers}/wslview`);
      expect(fileSystem.executables.get(`${openers}/xdg-open`)).toBe('#!/bin/sh\nexit 0\n');
    });

    describe('terminal logins', () => {
      it('should run the Copilot login under script with every word quoted', async () => {
        const { adapter, runner, fileSystem, record } = setup();
        fileSystem.addBinary('copilot').addBinary('script');

        adapter.startLogin('copilot', record);
        await flush();

        expect(runner.spawns[0]?.command).toBe('script');
        expect(runner.spawns[0]?.args).toEqual(['-qfec', '\'copilot\' \'login\' \'--device-code\'', '/dev/null']);
      });

      it('should run the CLI directly when script is not installed', async () => {
        const { adapter, runner, fileSystem, record } = setup();
        fileSystem.addBinary('copilot');

        adapter.startLogin('copilot', record);
        await flush();

        expect(runner.spawns[0]?.command).toBe('copilot');
        expect(runner.spawns[0]?.args).toEqual(['login', '--device-code']);
      });

      it('should answer the keychain question itself and keep it away from the user', async () => {
        const { adapter, runner, fileSystem, events, record } = setup();
        fileSystem.addBinary('copilot').addBinary('script');
        adapter.startLogin('copilot', record);
        await flush();

        runner.processes[0]?.print('System keychain unavailable. Store token in plaintext config file? (y/N) ');

        expect(runner.processes[0]?.written).toEqual(['y\n']);
        expect(events).toEqual([]);
      });

      it('should pass a question it has no answer for to the user as a prompt', async () => {
        const { adapter, runner, events, record } = setup();
        adapter.startLogin('claude', record);
        await flush();

        runner.processes[0]?.print('Overwrite the existing login? (y/N) ');

        expect(runner.processes[0]?.written).toEqual([]);
        expect(events).toEqual([{ kind: 'prompt', hint: 'Overwrite the existing login? (y/N)' }]);
      });
    });

    it('should use the opener directory alone when there is no PATH', async () => {
      const { adapter, runner, record } = setup();
      const originalPath = process.env.PATH;
      delete process.env.PATH;

      adapter.startLogin('claude', record);
      await flush();
      process.env.PATH = originalPath;

      expect(runner.spawns[0]?.options?.env?.PATH).toBe(`${tmpdir()}/arc-agent-auth-openers`);
    });

    it('should write the opener stand-ins once for every login', async () => {
      const { adapter, runner, record } = setup();
      adapter.startLogin('claude', record);
      await flush();
      runner.processes[0]?.exit(1);
      await flush();

      adapter.startLogin('codex', record);
      await flush();

      expect(runner.spawns.map(spawned => spawned.command)).toEqual(['claude', 'codex']);
    });

    it('should forward the link, the code and the prompt as the CLI prints them', async () => {
      const { adapter, runner, events, record } = setup();
      adapter.startLogin('claude', record);
      await flush();

      runner.processes[0]?.print('visit https://claude.com/cai/oauth/authorize?x=1\nPaste code here if prompted > ');
      runner.processes[0]?.print('Waiting\n', 'stderr');

      expect(events).toEqual([
        { kind: 'url', url: 'https://claude.com/cai/oauth/authorize?x=1' },
        { kind: 'prompt', hint: 'Paste code here if prompted >' },
      ]);
    });

    it('should complete when the CLI exits cleanly and reports a login', async () => {
      const { adapter, runner, events, record } = setup();
      runner.runResult = async () => ({ exitCode: 0, output: CLAUDE_LOGGED_IN });
      const subscription = adapter.startLogin('claude', record);
      await flush();

      runner.processes[0]?.exit(0);
      await subscription.done;

      expect(events).toEqual([{ kind: 'completed' }]);
    });

    it('should complete when the CLI exits cleanly and its status cannot be read', async () => {
      const { adapter, runner, events, record } = setup();
      runner.runResult = async () => ({ exitCode: 0, output: 'garbage' });
      const subscription = adapter.startLogin('claude', record);
      await flush();

      runner.processes[0]?.exit(0);
      await subscription.done;

      expect(events).toEqual([{ kind: 'completed' }]);
    });

    it('should fail when the CLI exits cleanly but still reports no login', async () => {
      const { adapter, runner, events, record } = setup();
      runner.runResult = async () => ({ exitCode: 1, output: CLAUDE_LOGGED_OUT });
      const subscription = adapter.startLogin('claude', record);
      await flush();

      runner.processes[0]?.exit(0);
      await subscription.done;

      expect(events).toEqual([{ kind: 'failed', reason: 'The login finished but the CLI still reports no login.' }]);
    });

    it('should fail with the last message the CLI printed, cut to a safe length', async () => {
      const { adapter, runner, events, record } = setup();
      const subscription = adapter.startLogin('claude', record);
      await flush();

      runner.processes[0]?.print(`open https://example.com/x\n${'e'.repeat(300)}\n`);
      runner.processes[0]?.exit(1);
      await subscription.done;

      expect(events.at(-1)).toEqual({ kind: 'failed', reason: 'e'.repeat(200) });
    });

    it('should fail with the exit code when the CLI printed nothing useful', async () => {
      const { adapter, runner, events, record } = setup();
      const subscription = adapter.startLogin('claude', record);
      await flush();

      runner.processes[0]?.exit(3);
      await subscription.done;

      expect(events).toEqual([{ kind: 'failed', reason: 'The login exited with code 3.' }]);
    });

    it('should fail when the CLI cannot be started', async () => {
      const { adapter, runner, events, record } = setup();
      runner.spawnError = new Error('EACCES');
      const subscription = adapter.startLogin('claude', record);

      await subscription.done;

      expect(events).toEqual([{ kind: 'failed', reason: 'Could not start the claude login.' }]);
    });

    it('should fail when the process reports a spawn error', async () => {
      const { adapter, runner, events, record } = setup();
      const subscription = adapter.startLogin('claude', record);
      await flush();

      runner.processes[0]?.emit('error', new Error('ENOENT'));
      await subscription.done;

      expect(events).toEqual([{ kind: 'failed', reason: 'Could not start the claude CLI.' }]);
    });

    it('should free the agent for a new login once one ended', async () => {
      const { adapter, runner, record } = setup();
      const first = adapter.startLogin('claude', record);
      await flush();
      runner.processes[0]?.exit(1);
      await first.done;

      adapter.startLogin('claude', record);
      await flush();

      expect(runner.spawns).toHaveLength(2);
    });

    describe('joining a running login', () => {
      it('should share the process and replay the last link and prompt to the newcomer', async () => {
        const { adapter, runner, events, record } = setup();
        const first = adapter.startLogin('claude', record);
        await flush();
        runner.processes[0]?.print('https://example.com/login\nPaste code here > ');
        const lateEvents: AgentLoginEvent[] = [];

        const second = adapter.startLogin('claude', event => lateEvents.push(event));

        expect(runner.spawns).toHaveLength(1);
        expect(lateEvents).toEqual([
          { kind: 'url', url: 'https://example.com/login' },
          { kind: 'prompt', hint: 'Paste code here >' },
        ]);
        expect(second.done).toBe(first.done);
        runner.processes[0]?.exit(2);
        await first.done;
        expect(lateEvents.at(-1)).toMatchObject({ kind: 'failed' });
        expect(events.at(-1)).toMatchObject({ kind: 'failed' });
      });

      it('should not replay what the CLI has not printed yet', async () => {
        const { adapter, record } = setup();
        adapter.startLogin('claude', record);
        const lateEvents: AgentLoginEvent[] = [];

        adapter.startLogin('claude', event => lateEvents.push(event));

        expect(lateEvents).toEqual([]);
      });

      it('should stop notifying a listener that unsubscribed', async () => {
        const { adapter, runner, events, record } = setup();
        const subscription = adapter.startLogin('claude', record);
        await flush();

        subscription.unsubscribe();
        runner.processes[0]?.print('https://example.com/login\n');

        expect(events).toEqual([]);
      });
    });

    describe('input', () => {
      it('should write a line to the CLI that waits for a code', async () => {
        const { adapter, runner, record } = setup();
        adapter.startLogin('claude', record);
        await flush();

        expect(adapter.submitInput('claude', 'abc#def')).toBe(true);

        expect(runner.processes[0]?.written).toEqual(['abc#def\n']);
      });

      it('should refuse input when no login is running', () => {
        expect(setup().adapter.submitInput('claude', 'code')).toBe(false);
      });

      it('should refuse input before the process exists', () => {
        const { adapter, record } = setup();
        adapter.startLogin('claude', record);

        expect(adapter.submitInput('claude', 'code')).toBe(false);
      });

      it('should refuse input once stdin closed', async () => {
        const { adapter, runner, record } = setup();
        adapter.startLogin('claude', record);
        await flush();
        const process = runner.processes[0];
        if (process) {
          process.stdin.writable = false;
        }

        expect(adapter.submitInput('claude', 'code')).toBe(false);
      });
    });

    describe('cancel', () => {
      it('should stop the process and report the cancellation', async () => {
        const { adapter, runner, events, record } = setup();
        const subscription = adapter.startLogin('claude', record);
        await flush();

        adapter.cancelLogin('claude');
        runner.processes[0]?.exit(143);
        await subscription.done;

        expect(runner.processes[0]?.killSignals).toEqual(['SIGTERM']);
        expect(events).toEqual([{ kind: 'cancelled' }]);
      });

      it('should kill a process that ignores the first signal', async () => {
        vi.useFakeTimers();
        const { adapter, runner, record } = setup();
        adapter.startLogin('claude', record);
        await vi.advanceTimersByTimeAsync(0);

        adapter.cancelLogin('claude');
        await vi.advanceTimersByTimeAsync(3000);

        expect(runner.processes[0]?.killSignals).toEqual(['SIGTERM', 'SIGKILL']);
      });

      it('should not escalate once the process ended', async () => {
        vi.useFakeTimers();
        const { adapter, runner, record } = setup();
        adapter.startLogin('claude', record);
        await vi.advanceTimersByTimeAsync(0);

        adapter.cancelLogin('claude');
        runner.processes[0]?.exit(143);
        await vi.advanceTimersByTimeAsync(3000);

        expect(runner.processes[0]?.killSignals).toEqual(['SIGTERM']);
      });

      it('should cancel before the process was spawned', async () => {
        const { adapter, runner, events, record } = setup();
        const subscription = adapter.startLogin('claude', record);

        adapter.cancelLogin('claude');
        await subscription.done;

        expect(runner.spawns).toEqual([]);
        expect(events).toEqual([{ kind: 'cancelled' }]);
      });

      it('should ignore an agent that is not logging in', () => {
        expect(() => setup().adapter.cancelLogin('claude')).not.toThrow();
      });

      it('should cancel every login when the module shuts down', async () => {
        const { adapter, runner, record } = setup();
        adapter.startLogin('claude', record);
        adapter.startLogin('codex', record);
        await flush();

        adapter.onModuleDestroy();

        expect(runner.processes.map(process => process.killSignals)).toEqual([['SIGTERM'], ['SIGTERM']]);
      });
    });

    describe('timeout', () => {
      beforeEach(() => {
        vi.useFakeTimers();
        process.env.AGENT_AUTH_LOGIN_TIMEOUT_MS = '60000';
      });

      it('should stop a login that takes too long', async () => {
        const { adapter, runner, events, record } = setup();
        const subscription = adapter.startLogin('claude', record);
        await vi.advanceTimersByTimeAsync(0);

        await vi.advanceTimersByTimeAsync(60_000);
        runner.processes[0]?.exit(143);
        await subscription.done;

        expect(runner.processes[0]?.killSignals).toContain('SIGTERM');
        expect(events).toEqual([{ kind: 'failed', reason: 'The login timed out.' }]);
      });

      it('should not time out a login that already ended', async () => {
        const { adapter, runner, record } = setup();
        const subscription = adapter.startLogin('claude', record);
        await vi.advanceTimersByTimeAsync(0);
        runner.processes[0]?.exit(1);
        await subscription.done;

        await vi.advanceTimersByTimeAsync(60_000);

        expect(runner.processes[0]?.killSignals).toEqual([]);
      });
    });
  });
});
