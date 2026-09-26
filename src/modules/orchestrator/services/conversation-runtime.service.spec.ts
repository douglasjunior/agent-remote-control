import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import { PromptCancelledError } from '../../agent/ports/agent.port.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { ConversationRuntimeService } from './conversation-runtime.service.js';


const IDLE_MS = 1000;

describe('ConversationRuntimeService', () => {
  let ports: StubAgentPort[];
  let runtime: ConversationRuntimeService;

  beforeEach(() => {
    vi.useFakeTimers();
    ports = [];
    const factory: IAgentPortFactory = {
      create: () => {
        const port = new StubAgentPort();
        ports.push(port);
        return port;
      },
    };
    runtime = new ConversationRuntimeService(factory, IDLE_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.SESSION_IDLE_TIMEOUT_MS;
  });

  const deferred = () => {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  it('should reuse one agent port per session and isolate different sessions', async () => {
    const seen: unknown[] = [];

    await runtime.run('a', async (port) => {
      seen.push(port);
    });
    await runtime.run('a', async (port) => {
      seen.push(port);
    });
    await runtime.run('b', async (port) => {
      seen.push(port);
    });

    expect(seen[0]).toBe(seen[1]);
    expect(seen[2]).not.toBe(seen[0]);
    expect(ports).toHaveLength(2);
  });

  it('should run turns of the same session one at a time in arrival order', async () => {
    const order: string[] = [];
    const first = deferred();
    const onQueued = vi.fn();

    const one = runtime.run('a', async () => {
      order.push('one:start');
      await first.promise;
      order.push('one:end');
    });
    const two = runtime.run('a', async () => {
      order.push('two');
    }, onQueued);

    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['one:start']);
    expect(onQueued).toHaveBeenCalledTimes(1);

    first.resolve();
    await Promise.all([one, two]);

    expect(order).toEqual(['one:start', 'one:end', 'two']);
  });

  it('should not notify onQueued when the session is idle', async () => {
    const onQueued = vi.fn();

    await runtime.run('a', async () => undefined, onQueued);

    expect(onQueued).not.toHaveBeenCalled();
  });

  it('should keep the queue running after a failed turn', async () => {
    const failing = runtime.run('a', async () => {
      throw new Error('boom');
    });
    const next = runtime.run('a', async () => 'ok');

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('should cancel only the turn in progress', async () => {
    const gate = deferred();
    const turnDone = runtime.run('a', async (_port, turn) => {
      await gate.promise;
      turn.throwIfCancelled();
    });
    await vi.advanceTimersByTimeAsync(0);

    await expect(runtime.cancel('a')).resolves.toBe(true);
    gate.resolve();

    await expect(turnDone).rejects.toBeInstanceOf(PromptCancelledError);
    expect(ports[0]!.cancelCalls).toBe(1);
    await expect(runtime.cancel('a')).resolves.toBe(false);
    await expect(runtime.cancel('unknown')).resolves.toBe(false);
  });

  it('should expire an idle session by closing its agent', async () => {
    await runtime.run('a', async () => undefined);

    await vi.advanceTimersByTimeAsync(IDLE_MS);

    expect(ports[0]!.closeSessionCalls).toBe(1);
    expect(ports[0]!.connected).toBe(false);

    await runtime.run('a', async () => undefined);
    expect(ports).toHaveLength(2);
  });

  it('should restart the idle countdown when a new turn arrives', async () => {
    await runtime.run('a', async () => undefined);
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);

    await runtime.run('a', async () => undefined);
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);

    expect(ports[0]!.closeSessionCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(ports[0]!.closeSessionCalls).toBe(1);
  });

  it('should not expire a session while a turn is running', async () => {
    const gate = deferred();
    const running = runtime.run('a', async () => gate.promise);

    await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
    expect(ports[0]!.closeSessionCalls).toBe(0);

    gate.resolve();
    await running;
  });

  it('should disconnect every agent on application shutdown', async () => {
    await runtime.run('a', async () => undefined);
    await runtime.run('b', async () => undefined);

    await runtime.onApplicationShutdown();

    expect(ports.every(port => !port.connected)).toBe(true);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(ports.every(port => port.closeSessionCalls === 0)).toBe(true);
  });

  it('should read the idle timeout from SESSION_IDLE_TIMEOUT_MS or default to 30 minutes', async () => {
    process.env.SESSION_IDLE_TIMEOUT_MS = '50';
    const created: StubAgentPort[] = [];
    const trackingFactory: IAgentPortFactory = {
      create: () => {
        const port = new StubAgentPort();
        created.push(port);
        return port;
      },
    };
    const envRuntime = new ConversationRuntimeService(trackingFactory);
    await envRuntime.run('a', async () => undefined);
    await vi.advanceTimersByTimeAsync(50);
    expect(created[0]!.closeSessionCalls).toBe(1);

    delete process.env.SESSION_IDLE_TIMEOUT_MS;
    const defaultRuntime = new ConversationRuntimeService(trackingFactory);
    await defaultRuntime.run('b', async () => undefined);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 - 1);
    expect(created[1]!.closeSessionCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(created[1]!.closeSessionCalls).toBe(1);
  });

  describe('active delegations', () => {
    it('should register, find, get, and unregister active delegations', () => {
      const delegatePort = new StubAgentPort();
      const delegation = {
        role: 'DEVELOPER',
        roleName: 'Developer Agent',
        projectName: 'my-app',
        taskSpec: 'Build it',
        cwd: '/mock/my-app',
        startedAt: Date.now(),
        agentPort: delegatePort,
        turn: { cancel: vi.fn() } as any,
        steer: vi.fn(),
      };

      runtime.registerDelegation('a', delegation);

      expect(runtime.getActiveDelegations('a')).toEqual([delegation]);
      expect(runtime.findActiveDelegation('a', 'developer')).toBe(delegation);
      expect(runtime.findActiveDelegation('a', 'unknown')).toBeUndefined();
      expect(runtime.getActiveDelegations('unknown')).toEqual([]);

      runtime.unregisterDelegation('a', 'developer');
      expect(runtime.getActiveDelegations('a')).toEqual([]);

      runtime.unregisterDelegation('unknown', 'developer');
      expect(runtime.getActiveDelegations('unknown')).toEqual([]);
    });

    it('should return CEO port for the given conversationKey', () => {
      const ceoPort = runtime.getCeoPort('a');
      expect(ceoPort).toBeDefined();
      expect(runtime.getCeoPort('a')).toBe(ceoPort);
    });

    it('should cancel both active turn and active delegations', async () => {
      const delegatePort = new StubAgentPort();
      const cancelTurnMock = vi.fn().mockResolvedValue(undefined);
      const delegation = {
        role: 'DEVELOPER',
        roleName: 'Developer Agent',
        projectName: 'my-app',
        taskSpec: 'Build it',
        cwd: '/mock/my-app',
        startedAt: Date.now(),
        agentPort: delegatePort,
        turn: { cancel: cancelTurnMock } as any,
        steer: vi.fn(),
      };

      runtime.registerDelegation('a', delegation);

      const gate = deferred();
      const turnDone = runtime.run('a', async (_port, turn) => {
        await gate.promise;
        turn.throwIfCancelled();
      });
      await vi.advanceTimersByTimeAsync(0);

      await expect(runtime.cancel('a')).resolves.toBe(true);
      expect(cancelTurnMock).toHaveBeenCalled();

      gate.resolve();
      await expect(turnDone).rejects.toBeInstanceOf(PromptCancelledError);
    });

    it('should disconnect active delegations on shutdown', async () => {
      const delegatePort = new StubAgentPort();
      delegatePort.connected = true;
      const delegation = {
        role: 'DEVELOPER',
        roleName: 'Developer Agent',
        projectName: 'my-app',
        taskSpec: 'Build it',
        cwd: '/mock/my-app',
        startedAt: Date.now(),
        agentPort: delegatePort,
        turn: { cancel: vi.fn() } as any,
        steer: vi.fn(),
      };

      runtime.registerDelegation('a', delegation);
      await runtime.onApplicationShutdown();

      expect(delegatePort.connected).toBe(false);
      expect(runtime.getActiveDelegations('a')).toEqual([]);
    });

    it('should not expire a session while an active delegation is registered', async () => {
      const delegatePort = new StubAgentPort();
      delegatePort.connected = true;
      const delegation = {
        role: 'DEVELOPER',
        roleName: 'Developer Agent',
        projectName: 'my-app',
        taskSpec: 'Build it',
        cwd: '/mock/my-app',
        startedAt: Date.now(),
        agentPort: delegatePort,
        turn: { cancel: vi.fn() } as any,
        steer: vi.fn(),
      };

      runtime.registerDelegation('a', delegation);
      await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
      expect(ports[0]!.closeSessionCalls).toBe(0);

      runtime.unregisterDelegation('a', 'DEVELOPER');
      await vi.advanceTimersByTimeAsync(IDLE_MS);
      expect(ports[0]!.closeSessionCalls).toBe(1);
    });

    it('should schedule expiration when runOnCeo completes and no other turns or delegations are active', async () => {
      await runtime.runOnCeo('a', async () => undefined);
      await vi.advanceTimersByTimeAsync(IDLE_MS);
      expect(ports[0]!.closeSessionCalls).toBe(1);
    });

    it('should close sessions and disconnect active delegations on expiration', async () => {
      const delegatePort = new StubAgentPort();
      delegatePort.connected = true;
      const delegation = {
        role: 'DEVELOPER',
        roleName: 'Developer Agent',
        projectName: 'my-app',
        taskSpec: 'Build it',
        cwd: '/mock/my-app',
        startedAt: Date.now(),
        agentPort: delegatePort,
        turn: { cancel: vi.fn() } as any,
        steer: vi.fn(),
      };

      runtime.registerDelegation('a', delegation);
      await (runtime as any).expire('a', (runtime as any).getOrCreate('a'));

      expect(delegatePort.closeSessionCalls).toBe(1);
      expect(delegatePort.connected).toBe(false);
      expect(runtime.getActiveDelegations('a')).toEqual([]);
    });
  });
});
