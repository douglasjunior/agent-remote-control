import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptCancelledError } from '../../agent/ports/agent.port.js';
import { StubAgentPortFactory } from '../testing/stub-agent-port-factory.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { ConversationRuntimeService } from './conversation-runtime.service.js';


const IDLE_MS = 1000;

describe('ConversationRuntimeService', () => {
  let ports: StubAgentPort[];
  let factory: StubAgentPortFactory;
  let runtime: ConversationRuntimeService;

  const buildTrackedFactory = (): StubAgentPortFactory => new StubAgentPortFactory((agentId) => {
    const port = new StubAgentPort();
    port.agentName = agentId;
    ports.push(port);
    return port;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    ports = [];
    factory = buildTrackedFactory();
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

    await runtime.run('a', 'stub', async (port) => {
      seen.push(port);
    });
    await runtime.run('a', 'stub', async (port) => {
      seen.push(port);
    });
    await runtime.run('b', 'stub', async (port) => {
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

    const one = runtime.run('a', 'stub', async () => {
      order.push('one:start');
      await first.promise;
      order.push('one:end');
    });
    const two = runtime.run('a', 'stub', async () => {
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

    await runtime.run('a', 'stub', async () => undefined, onQueued);

    expect(onQueued).not.toHaveBeenCalled();
  });

  it('should keep the queue running after a failed turn', async () => {
    const failing = runtime.run('a', 'stub', async () => {
      throw new Error('boom');
    });
    const next = runtime.run('a', 'stub', async () => 'ok');

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('should cancel only the turn in progress', async () => {
    const gate = deferred();
    const turnDone = runtime.run('a', 'stub', async (_port, turn) => {
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
    await runtime.run('a', 'stub', async () => undefined);

    await vi.advanceTimersByTimeAsync(IDLE_MS);

    expect(ports[0]!.closeSessionCalls).toBe(1);
    expect(ports[0]!.connected).toBe(false);

    await runtime.run('a', 'stub', async () => undefined);
    expect(ports).toHaveLength(2);
  });

  it('should restart the idle countdown when a new turn arrives', async () => {
    await runtime.run('a', 'stub', async () => undefined);
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);

    await runtime.run('a', 'stub', async () => undefined);
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);

    expect(ports[0]!.closeSessionCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(ports[0]!.closeSessionCalls).toBe(1);
  });

  it('should not expire a session while a turn is running', async () => {
    const gate = deferred();
    const running = runtime.run('a', 'stub', async () => gate.promise);

    await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
    expect(ports[0]!.closeSessionCalls).toBe(0);

    gate.resolve();
    await running;
  });

  it('should disconnect every agent on application shutdown', async () => {
    await runtime.run('a', 'stub', async () => undefined);
    await runtime.run('b', 'stub', async () => undefined);

    await runtime.onApplicationShutdown();

    expect(ports.every(port => !port.connected)).toBe(true);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(ports.every(port => port.closeSessionCalls === 0)).toBe(true);
  });

  it('should read the idle timeout from SESSION_IDLE_TIMEOUT_MS or default to 30 minutes', async () => {
    process.env.SESSION_IDLE_TIMEOUT_MS = '50';
    const created = ports;
    const trackingFactory = factory;
    const envRuntime = new ConversationRuntimeService(trackingFactory);
    await envRuntime.run('a', 'stub', async () => undefined);
    await vi.advanceTimersByTimeAsync(50);
    expect(created[0]!.closeSessionCalls).toBe(1);

    delete process.env.SESSION_IDLE_TIMEOUT_MS;
    const defaultRuntime = new ConversationRuntimeService(trackingFactory);
    await defaultRuntime.run('b', 'stub', async () => undefined);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 - 1);
    expect(created[1]!.closeSessionCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(created[1]!.closeSessionCalls).toBe(1);
  });

  describe('CEO port', () => {
    it('should create the CEO port lazily with the requested agent', async () => {
      expect(runtime.getCeoPort('a')).toBeUndefined();
      expect(factory.createdAgentIds).toEqual([]);

      await runtime.run('a', 'other', async (port) => {
        expect(port.agentName).toBe('other');
      });

      expect(factory.createdAgentIds).toEqual(['other']);
      expect(runtime.getCeoPort('a')).toBe(ports[0]);
    });

    it('should reuse the CEO port while the agent stays the same', async () => {
      await runtime.run('a', 'other', async () => undefined);
      await runtime.runOnCeo('a', 'other', async () => undefined);

      expect(ports).toHaveLength(1);
      expect(factory.createdAgentIds).toEqual(['other']);
    });

    it('should close and disconnect the previous CEO port when the agent changes', async () => {
      await runtime.run('a', 'first', async (port) => {
        (port as StubAgentPort).connected = true;
      });

      let current: unknown;
      await runtime.run('a', 'second', async (port) => {
        current = port;
      });

      expect(ports).toHaveLength(2);
      expect(ports[0]!.closeSessionCalls).toBe(1);
      expect(ports[0]!.connected).toBe(false);
      expect(current).toBe(ports[1]);
      expect(ports[1]!.agentName).toBe('second');
      expect(runtime.getCeoPort('a')).toBe(ports[1]);
    });

    it('should ignore failures while disposing the previous CEO port', async () => {
      await runtime.run('a', 'first', async () => undefined);
      ports[0]!.closeSession = async () => {
        throw new Error('close failed');
      };
      ports[0]!.disconnect = async () => {
        throw new Error('disconnect failed');
      };

      await expect(runtime.run('a', 'second', async port => port.agentName)).resolves.toBe('second');
      expect(runtime.getCeoPort('a')).toBe(ports[1]);
    });

    it('should switch the agent only after the queued turn of the previous agent finishes', async () => {
      const gate = deferred();
      const order: string[] = [];

      const first = runtime.run('a', 'first', async () => {
        order.push('first:start');
        await gate.promise;
        order.push(`first:closed=${ports[0]!.closeSessionCalls}`);
      });
      const second = runtime.run('a', 'second', async () => {
        order.push(`second:firstClosed=${ports[0]!.closeSessionCalls}`);
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(order).toEqual(['first:start']);

      gate.resolve();
      await Promise.all([first, second]);

      expect(order).toEqual(['first:start', 'first:closed=0', 'second:firstClosed=1']);
    });

    it('should keep the queue running when creating the CEO port fails', async () => {
      const failingFactory = new StubAgentPortFactory((agentId) => {
        if (agentId === 'broken') {
          throw new Error('cannot create');
        }
        return buildTrackedFactory().create(agentId);
      });
      runtime = new ConversationRuntimeService(failingFactory, IDLE_MS);

      await expect(runtime.run('a', 'broken', async () => 'never')).rejects.toThrow('cannot create');
      await expect(runtime.run('a', 'fine', async port => port.agentName)).resolves.toBe('fine');
    });
  });

  describe('steerCeo', () => {
    const supportSteeringOnCreate = (): void => {
      factory = new StubAgentPortFactory((agentId) => {
        const port = new StubAgentPort();
        port.agentName = agentId;
        port.supportsSteering = true;
        ports.push(port);
        return port;
      });
      runtime = new ConversationRuntimeService(factory, IDLE_MS);
    };

    const startRunningCeo = async (agentId = 'stub') => {
      const gate = deferred();
      const running = runtime.run('a', agentId, async () => gate.promise);
      await vi.advanceTimersByTimeAsync(0);
      return { gate, running };
    };

    it('should inject the text into the CEO round in progress and return the port answer', async () => {
      supportSteeringOnCreate();
      const { gate, running } = await startRunningCeo();

      await expect(runtime.steerCeo('a', 'stub', 'new message')).resolves.toBe(true);

      expect(ports[0]!.steeringPrompts).toEqual(['new message']);
      gate.resolve();
      await running;
    });

    it('should return false when the port does not accept the steering', async () => {
      supportSteeringOnCreate();
      const { gate, running } = await startRunningCeo();
      ports[0]!.steeringResult = false;

      await expect(runtime.steerCeo('a', 'stub', 'new message')).resolves.toBe(false);

      expect(ports[0]!.steeringPrompts).toEqual(['new message']);
      gate.resolve();
      await running;
    });

    it('should return false when the conversation has no runtime', async () => {
      await expect(runtime.steerCeo('unknown', 'stub', 'text')).resolves.toBe(false);
    });

    it('should return false when the runtime has no CEO port yet', async () => {
      runtime.beginTurn('a');

      await expect(runtime.steerCeo('a', 'stub', 'text')).resolves.toBe(false);
    });

    it('should return false when no CEO round is running', async () => {
      supportSteeringOnCreate();
      await runtime.run('a', 'stub', async () => undefined);

      await expect(runtime.steerCeo('a', 'stub', 'text')).resolves.toBe(false);

      expect(ports[0]!.steeringPrompts).toEqual([]);
    });

    it('should return false when the running CEO turn was cancelled', async () => {
      supportSteeringOnCreate();
      const { gate, running } = await startRunningCeo();
      await runtime.cancel('a');

      await expect(runtime.steerCeo('a', 'stub', 'text')).resolves.toBe(false);

      expect(ports[0]!.steeringPrompts).toEqual([]);
      gate.resolve();
      await running;
    });

    it('should return false when another turn is already queued behind the running one', async () => {
      supportSteeringOnCreate();
      const { gate, running } = await startRunningCeo();
      const queued = runtime.run('a', 'stub', async () => undefined);

      await expect(runtime.steerCeo('a', 'stub', 'text')).resolves.toBe(false);

      expect(ports[0]!.steeringPrompts).toEqual([]);
      gate.resolve();
      await Promise.all([running, queued]);
    });

    it('should return false when the CEO runs on a different agent', async () => {
      supportSteeringOnCreate();
      const { gate, running } = await startRunningCeo('first');

      await expect(runtime.steerCeo('a', 'second', 'text')).resolves.toBe(false);

      expect(ports[0]!.steeringPrompts).toEqual([]);
      gate.resolve();
      await running;
    });

    it('should return false when the CEO agent does not support steering', async () => {
      const { gate, running } = await startRunningCeo();

      await expect(runtime.steerCeo('a', 'stub', 'text')).resolves.toBe(false);

      expect(ports[0]!.steeringPrompts).toEqual([]);
      gate.resolve();
      await running;
    });
  });

  describe('active delegations', () => {
    it('should register, find, get, and unregister active delegations', () => {
      const delegatePort = new StubAgentPort();
      const delegation = {
        role: 'DEVELOPER',
        roleName: 'Developer Agent',
        agentInfo: { roleName: 'Developer Agent', agentName: 'stub' },
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

      runtime.unregisterDelegation('a', delegation);
      expect(runtime.getActiveDelegations('a')).toEqual([]);

      runtime.unregisterDelegation('unknown', delegation);
      expect(runtime.getActiveDelegations('unknown')).toEqual([]);
    });

    it('should keep one delegation per role, whatever the project, and one per other role alongside it', () => {
      const backend = {
        role: 'DEVELOPER',
        roleName: 'Developer Agent',
        agentInfo: { roleName: 'Developer Agent', agentName: 'stub' },
        projectName: 'backend',
        taskSpec: 'Build the API',
        cwd: '/mock/backend',
        startedAt: Date.now(),
        agentPort: new StubAgentPort(),
        turn: { cancel: vi.fn() } as any,
        steer: vi.fn(),
      };
      const frontend = { ...backend, projectName: 'frontend', cwd: '/mock/frontend', agentPort: new StubAgentPort() };
      const planner = { ...backend, role: 'TECH_LEAD', roleName: 'Tech Lead', agentPort: new StubAgentPort() };

      runtime.registerDelegation('a', backend);
      runtime.registerDelegation('a', planner);
      runtime.registerDelegation('a', frontend);

      expect(runtime.getActiveDelegations('a')).toEqual([frontend, planner]);
      expect(runtime.findActiveDelegation('a', 'DEVELOPER')).toBe(frontend);
      expect(runtime.findActiveDelegation('a', 'TECH_LEAD')).toBe(planner);
    });

    it('should ignore unregisterDelegation when delegation parameter does not match current active delegation', () => {
      const delegatePort1 = new StubAgentPort();
      const delegatePort2 = new StubAgentPort();
      const delegation1 = {
        role: 'DEVELOPER',
        roleName: 'Developer Agent',
        agentInfo: { roleName: 'Developer Agent', agentName: 'stub' },
        projectName: 'my-app',
        taskSpec: 'Build it',
        cwd: '/mock/my-app',
        startedAt: Date.now(),
        agentPort: delegatePort1,
        turn: { cancel: vi.fn() } as any,
        steer: vi.fn(),
      };
      const delegation2 = {
        ...delegation1,
        agentPort: delegatePort2,
        taskSpec: 'Build it new',
      };

      runtime.registerDelegation('a', delegation1);
      runtime.registerDelegation('a', delegation2);

      runtime.unregisterDelegation('a', delegation1);
      expect(runtime.getActiveDelegations('a')).toEqual([delegation2]);
      expect(runtime.findActiveDelegation('a', 'DEVELOPER')).toBe(delegation2);

      runtime.unregisterDelegation('a', delegation2);
      expect(runtime.getActiveDelegations('a')).toEqual([]);
    });

    it('should cancel both active turn and active delegations', async () => {
      const delegatePort = new StubAgentPort();
      const cancelTurnMock = vi.fn().mockResolvedValue(undefined);
      const delegation = {
        role: 'DEVELOPER',
        roleName: 'Developer Agent',
        agentInfo: { roleName: 'Developer Agent', agentName: 'stub' },
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
      const turnDone = runtime.run('a', 'stub', async (_port, turn) => {
        await gate.promise;
        turn.throwIfCancelled();
      });
      await vi.advanceTimersByTimeAsync(0);

      await expect(runtime.cancel('a')).resolves.toBe(true);
      expect(cancelTurnMock).toHaveBeenCalled();

      gate.resolve();
      await expect(turnDone).rejects.toBeInstanceOf(PromptCancelledError);
    });

    it('should cancel active delegations concurrently and rethrow if any cancel rejects', async () => {
      const cancelMock1 = vi.fn().mockRejectedValue(new Error('fail 1'));
      const cancelMock2 = vi.fn().mockResolvedValue(undefined);
      runtime.registerDelegation('a', {
        role: 'DEVELOPER',
        roleName: 'Developer',
        agentInfo: { roleName: 'Developer', agentName: 'stub' },
        projectName: 'app',
        taskSpec: 'task',
        cwd: '/mock',
        startedAt: Date.now(),
        agentPort: new StubAgentPort(),
        turn: { cancel: cancelMock1 } as any,
        steer: vi.fn(),
      });
      runtime.registerDelegation('a', {
        role: 'CODE_REVIEWER',
        roleName: 'Reviewer',
        agentInfo: { roleName: 'Reviewer', agentName: 'stub' },
        projectName: null,
        taskSpec: 'review',
        cwd: '/mock',
        startedAt: Date.now(),
        agentPort: new StubAgentPort(),
        turn: { cancel: cancelMock2 } as any,
        steer: vi.fn(),
      });

      await expect(runtime.cancel('a')).rejects.toThrow('fail 1');
      expect(cancelMock1).toHaveBeenCalled();
      expect(cancelMock2).toHaveBeenCalled();
    });

    it('should cancel active delegations concurrently when all succeed', async () => {
      const cancelMock1 = vi.fn().mockResolvedValue(undefined);
      const cancelMock2 = vi.fn().mockResolvedValue(undefined);
      runtime.registerDelegation('a', {
        role: 'DEVELOPER',
        roleName: 'Developer',
        agentInfo: { roleName: 'Developer', agentName: 'stub' },
        projectName: 'app',
        taskSpec: 'task',
        cwd: '/mock',
        startedAt: Date.now(),
        agentPort: new StubAgentPort(),
        turn: { cancel: cancelMock1 } as any,
        steer: vi.fn(),
      });
      runtime.registerDelegation('a', {
        role: 'CODE_REVIEWER',
        roleName: 'Reviewer',
        agentInfo: { roleName: 'Reviewer', agentName: 'stub' },
        projectName: null,
        taskSpec: 'review',
        cwd: '/mock',
        startedAt: Date.now(),
        agentPort: new StubAgentPort(),
        turn: { cancel: cancelMock2 } as any,
        steer: vi.fn(),
      });

      await expect(runtime.cancel('a')).resolves.toBe(true);
      expect(cancelMock1).toHaveBeenCalled();
      expect(cancelMock2).toHaveBeenCalled();
    });

    it('should disconnect active delegations on shutdown', async () => {
      const delegatePort = new StubAgentPort();
      delegatePort.connected = true;
      const delegation = {
        role: 'DEVELOPER',
        roleName: 'Developer Agent',
        agentInfo: { roleName: 'Developer Agent', agentName: 'stub' },
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
        agentInfo: { roleName: 'Developer Agent', agentName: 'stub' },
        projectName: 'my-app',
        taskSpec: 'Build it',
        cwd: '/mock/my-app',
        startedAt: Date.now(),
        agentPort: delegatePort,
        turn: { cancel: vi.fn() } as any,
        steer: vi.fn(),
      };

      await runtime.run('a', 'stub', async () => undefined);
      runtime.registerDelegation('a', delegation);
      await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
      expect(ports[0]!.closeSessionCalls).toBe(0);

      runtime.unregisterDelegation('a', delegation);
      await vi.advanceTimersByTimeAsync(IDLE_MS);
      expect(ports[0]!.closeSessionCalls).toBe(1);
    });

    it('should schedule expiration when runOnCeo completes and no other turns or delegations are active', async () => {
      await runtime.runOnCeo('a', 'stub', async () => undefined);
      await vi.advanceTimersByTimeAsync(IDLE_MS);
      expect(ports[0]!.closeSessionCalls).toBe(1);
    });

    it('should close sessions and disconnect active delegations on expiration', async () => {
      const delegatePort = new StubAgentPort();
      delegatePort.connected = true;
      const delegation = {
        role: 'DEVELOPER',
        roleName: 'Developer Agent',
        agentInfo: { roleName: 'Developer Agent', agentName: 'stub' },
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

  describe('teardown failures', () => {
    const failingPort = (): StubAgentPort => {
      const port = new StubAgentPort();
      port.closeSession = async () => {
        throw new Error('close failed');
      };
      port.disconnect = async () => {
        throw new Error('disconnect failed');
      };
      return port;
    };

    const registerDelegationOn = (port: StubAgentPort) => runtime.registerDelegation('a', {
      role: 'DEVELOPER',
      roleName: 'Developer',
      agentInfo: { roleName: 'Developer', agentName: 'stub' },
      projectName: null,
      taskSpec: 'task',
      cwd: '/mock',
      startedAt: Date.now(),
      agentPort: port,
      turn: { cancel: vi.fn() } as any,
      steer: vi.fn(),
    });

    it('should tear down every agent on shutdown even when disconnecting fails', async () => {
      const failingFactory = new StubAgentPortFactory(failingPort);
      runtime = new ConversationRuntimeService(failingFactory, IDLE_MS);
      await runtime.run('a', 'stub', async () => undefined);
      registerDelegationOn(failingPort());

      await expect(runtime.onApplicationShutdown()).resolves.toBeUndefined();
      expect(runtime.getActiveDelegations('a')).toEqual([]);
    });

    it('should expire an idle session even when closing its agents fails', async () => {
      const failingFactory = new StubAgentPortFactory(failingPort);
      runtime = new ConversationRuntimeService(failingFactory, IDLE_MS);
      await runtime.run('a', 'stub', async () => undefined);
      registerDelegationOn(failingPort());
      runtime.unregisterDelegation('unknown', runtime.getActiveDelegations('a')[0]!);

      await (runtime as any).expire('a', (runtime as any).getOrCreate('a'));

      expect(runtime.getActiveDelegations('a')).toEqual([]);
      expect(runtime.getCeoPort('a')).toBeUndefined();
    });
  });
});
