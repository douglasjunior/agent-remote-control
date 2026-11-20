import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';

import { type IAgentPort, PromptCancelledError } from '../../agent/ports/agent.port.js';
import { StubRuntimeSettings } from '../../settings/testing/stub-runtime-settings.js';
import type { ActiveDelegation } from '../models/active-delegation.model.js';
import type { ActiveTurn } from '../models/active-turn.model.js';
import { PendingMessage, type JoinOutcome } from '../models/conversation-turn.model.js';
import { DelegationControl } from '../models/delegation-control.model.js';
import { createServedToolSessions, credentialOf } from '../testing/agent-tool-sessions.fixture.js';
import { StubAgentPortFactory } from '../testing/stub-agent-port-factory.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import type { AgentToolSessionsService } from './agent-tool-sessions.service.js';
import { ConversationRuntimeService } from './conversation-runtime.service.js';


const IDLE_MS = 1000;

describe('ConversationRuntimeService', () => {
  let ports: StubAgentPort[];
  let factory: StubAgentPortFactory;
  let runtime: ConversationRuntimeService;
  let toolSessions: AgentToolSessionsService;

  const buildTrackedFactory = (): StubAgentPortFactory => new StubAgentPortFactory((agentId) => {
    const port = new StubAgentPort();
    port.agentName = agentId;
    ports.push(port);
    return port;
  });

  beforeEach(() => {
    rs.useFakeTimers();
    ports = [];
    factory = buildTrackedFactory();
    toolSessions = createServedToolSessions();
    runtime = new ConversationRuntimeService(factory, toolSessions, new StubRuntimeSettings({ SESSION_IDLE_TIMEOUT_MS: IDLE_MS }));
  });

  afterEach(() => {
    rs.useRealTimers();
  });

  /** Runs `work` on the CEO as the conversation's turn, which ends with it. */
  const run = <T>(key: string, agentId: string, work: (port: IAgentPort, ceo: ActiveTurn) => Promise<T>): Promise<T> => {
    const { turn } = runtime.admit(key);
    return runtime.runOnCeo(key, turn, agentId, work).finally(() => runtime.endTurn(key, turn));
  };

  const message = (text: string) => {
    const outcomes: JoinOutcome[] = [];
    const onDelivery = rs.fn();
    const pending = new PendingMessage(text, { conversationId: 'a', userId: 'u', prompt: text, workspacePath: '/w', agentRole: 'CEO', onDelivery }, outcome => outcomes.push(outcome));
    return { pending, outcomes, onDelivery };
  };

  const deferred = () => {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  it('should reuse one agent port per session and isolate different sessions', async () => {
    const seen: unknown[] = [];

    await run('a', 'stub', async (port) => {
      seen.push(port);
    });
    await run('a', 'stub', async (port) => {
      seen.push(port);
    });
    await run('b', 'stub', async (port) => {
      seen.push(port);
    });

    expect(seen[0]).toBe(seen[1]);
    expect(seen[2]).not.toBe(seen[0]);
    expect(ports).toHaveLength(2);
  });

  describe('one turn at a time', () => {
    it('should start a turn when none runs and let a message join the one running', () => {
      const first = runtime.admit('a');
      const second = runtime.admit('a');

      expect(first.kind).toBe('drive');
      expect(second).toEqual({ kind: 'join', turn: first.turn });
      expect(runtime.admit('b').kind).toBe('drive');
    });

    it('should hand the next turn to the first message left in the inbox, with the others read in it', () => {
      const { turn } = runtime.admit('a');
      const one = message('one');
      const two = message('two');
      turn.enqueue(one.pending);
      turn.enqueue(two.pending);

      runtime.endTurn('a', turn);

      const next = one.outcomes[0];
      expect(next?.kind).toBe('drive');
      const nextTurn = (next as Extract<JoinOutcome, { kind: 'drive' }>).turn;
      expect(nextTurn).not.toBe(turn);
      expect(nextTurn.joined).toEqual(['two']);
      expect(nextTurn.take()).toEqual([two.pending]);
      expect(two.outcomes).toEqual([]);
      expect(runtime.admit('a')).toEqual({ kind: 'join', turn: nextTurn });
    });

    it('should start the next turn after a turn that failed', async () => {
      await expect(run('a', 'stub', async () => {
        throw new Error('boom');
      })).rejects.toThrow('boom');

      expect(runtime.admit('a').kind).toBe('drive');
    });

    it('should ignore the end of a turn that is no longer the running one', () => {
      const { turn } = runtime.admit('a');
      runtime.endTurn('a', turn);
      const { turn: next } = runtime.admit('a');

      runtime.endTurn('a', turn);

      expect(runtime.admit('a')).toEqual({ kind: 'join', turn: next });
      runtime.endTurn('unknown', turn);
    });

    it('should give a turn that resumes work the conversation once the running turn ends', async () => {
      await expect(runtime.acquire('b')).resolves.toBeDefined();
      const { turn } = runtime.admit('a');
      let resumed: unknown;
      void runtime.acquire('a').then((acquired) => {
        resumed = acquired;
      });
      await rs.advanceTimersByTimeAsync(0);
      expect(resumed).toBeUndefined();

      runtime.endTurn('a', turn);
      await rs.advanceTimersByTimeAsync(0);

      expect(resumed).toBeDefined();
      expect(resumed).not.toBe(turn);
      expect(runtime.admit('a')).toEqual({ kind: 'join', turn: resumed });
    });

    it('should cancel the running turn with the messages of its inbox and the turns waiting to resume work', async () => {
      const { turn } = runtime.admit('a');
      const waiting = message('waiting');
      turn.enqueue(waiting.pending);
      const resumption = runtime.acquire('a');

      await expect(runtime.cancel('a')).resolves.toBe(true);

      expect(turn.isCancelled).toBe(true);
      expect(waiting.outcomes).toEqual([{ kind: 'cancelled' }]);
      expect(waiting.onDelivery).toHaveBeenCalledWith('cancelled');
      await expect(resumption).resolves.toBeUndefined();
      await expect(runtime.cancel('a')).resolves.toBe(false);

      const after = message('after');
      turn.enqueue(after.pending);
      runtime.endTurn('a', turn);
      expect(after.outcomes[0]?.kind).toBe('drive');
    });

    it('should refuse a CEO prompt in a cancelled turn', async () => {
      const { turn } = runtime.admit('a');
      await runtime.cancel('a');
      const work = rs.fn();

      await expect(runtime.runOnCeo('a', turn, 'stub', work)).rejects.toBeInstanceOf(PromptCancelledError);
      expect(work).not.toHaveBeenCalled();
    });

    it('should refuse a CEO prompt of a turn cancelled while its port was being prepared', async () => {
      const { turn } = runtime.admit('a');
      const work = rs.fn();
      factory = new StubAgentPortFactory(() => {
        void turn.cancel();
        return new StubAgentPort();
      });
      runtime = new ConversationRuntimeService(factory, toolSessions, new StubRuntimeSettings({ SESSION_IDLE_TIMEOUT_MS: IDLE_MS }));

      await expect(runtime.runOnCeo('a', turn, 'stub', work)).rejects.toBeInstanceOf(PromptCancelledError);
      expect(work).not.toHaveBeenCalled();
    });
  });

  it('should cancel the CEO prompt of the turn in progress', async () => {
    const gate = deferred();
    const turnDone = run('a', 'stub', async (_port, ceo) => {
      await gate.promise;
      ceo.throwIfCancelled();
    });
    await rs.advanceTimersByTimeAsync(0);

    await expect(runtime.cancel('a')).resolves.toBe(true);
    gate.resolve();

    await expect(turnDone).rejects.toBeInstanceOf(PromptCancelledError);
    expect(ports[0]!.cancelCalls).toBe(1);
    await expect(runtime.cancel('a')).resolves.toBe(false);
    await expect(runtime.cancel('unknown')).resolves.toBe(false);
  });

  it('should expire an idle session by closing its agent', async () => {
    await run('a', 'stub', async () => undefined);

    await rs.advanceTimersByTimeAsync(IDLE_MS);

    expect(ports[0]!.closeSessionCalls).toBe(1);
    expect(ports[0]!.connected).toBe(false);

    await run('a', 'stub', async () => undefined);
    expect(ports).toHaveLength(2);
  });

  it('should restart the idle countdown when a new turn arrives', async () => {
    await run('a', 'stub', async () => undefined);
    await rs.advanceTimersByTimeAsync(IDLE_MS - 1);

    await run('a', 'stub', async () => undefined);
    await rs.advanceTimersByTimeAsync(IDLE_MS - 1);

    expect(ports[0]!.closeSessionCalls).toBe(0);
    await rs.advanceTimersByTimeAsync(1);
    expect(ports[0]!.closeSessionCalls).toBe(1);
  });

  it('should not expire a session while a turn is running', async () => {
    const gate = deferred();
    const running = run('a', 'stub', async () => gate.promise);

    await rs.advanceTimersByTimeAsync(IDLE_MS * 2);
    expect(ports[0]!.closeSessionCalls).toBe(0);

    gate.resolve();
    await running;
  });

  it('should disconnect every agent on application shutdown', async () => {
    await run('a', 'stub', async () => undefined);
    await run('b', 'stub', async () => undefined);

    await runtime.onApplicationShutdown();

    expect(ports.every(port => !port.connected)).toBe(true);
    await rs.advanceTimersByTimeAsync(IDLE_MS);
    expect(ports.every(port => port.closeSessionCalls === 0)).toBe(true);
  });

  describe('tool sessions', () => {
    const requester = { role: 'CEO', roleName: 'CEO', conversationId: 'a' };
    const openTools = (port: StubAgentPort): string => {
      port.supportsHttpMcp = true;
      return credentialOf(toolSessions.open(port, { requester }));
    };
    const delegationOn = (agentPort: StubAgentPort): ActiveDelegation => ({
      delegationId: 'd-1',
      role: 'DEVELOPER',
      roleName: 'Developer Agent',
      agentInfo: { roleName: 'Developer Agent', agentName: 'stub' },
      projectName: 'my-app',
      artifactId: null,
      summary: 'Summary',
      taskSpec: 'Build it',
      cwd: '/mock/my-app',
      startedAt: Date.now(),
      agentPort,
      turn: { cancel: rs.fn() } as never,
      control: new DelegationControl({ runId: 'd', summary: 'Summary', contextSince: '' }),
      stop: rs.fn(),
    });

    it('should close the tool session of the CEO when the conversation expires', async () => {
      await run('a', 'stub', async () => undefined);
      const credential = openTools(ports[0]!);

      await rs.advanceTimersByTimeAsync(IDLE_MS);

      expect(toolSessions.find(credential)).toBeUndefined();
    });

    it('should close the tool session of the previous CEO port when the agent changes', async () => {
      await run('a', 'first', async () => undefined);
      const credential = openTools(ports[0]!);

      await run('a', 'second', async () => undefined);

      expect(toolSessions.find(credential)).toBeUndefined();
    });

    it('should close every tool session on application shutdown', async () => {
      await run('a', 'stub', async () => undefined);
      const ceo = openTools(ports[0]!);
      const delegatePort = new StubAgentPort();
      const delegate = openTools(delegatePort);
      runtime.registerDelegation('a', delegationOn(delegatePort));

      await runtime.onApplicationShutdown();

      expect(toolSessions.find(ceo)).toBeUndefined();
      expect(toolSessions.find(delegate)).toBeUndefined();
    });
  });

  it('should read the idle timeout as each idle period starts', async () => {
    const settings = new StubRuntimeSettings();
    const created = ports;
    runtime = new ConversationRuntimeService(factory, toolSessions, settings);
    await run('a', 'stub', async () => undefined);
    await rs.advanceTimersByTimeAsync(30 * 60 * 1000 - 1);
    expect(created[0]!.closeSessionCalls).toBe(0);
    await rs.advanceTimersByTimeAsync(1);
    expect(created[0]!.closeSessionCalls).toBe(1);

    settings.set('SESSION_IDLE_TIMEOUT_MS', 50);
    await run('b', 'stub', async () => undefined);
    await rs.advanceTimersByTimeAsync(50);
    expect(created[1]!.closeSessionCalls).toBe(1);
  });

  describe('CEO port', () => {
    it('should create the CEO port lazily with the requested agent', async () => {
      expect(runtime.getCeoPort('a')).toBeUndefined();
      expect(factory.createdAgentIds).toEqual([]);

      await run('a', 'other', async (port) => {
        expect(port.agentName).toBe('other');
      });

      expect(factory.createdAgentIds).toEqual(['other']);
      expect(runtime.getCeoPort('a')).toBe(ports[0]);
    });

    it('should reuse the CEO port while the agent stays the same', async () => {
      await run('a', 'other', async () => undefined);
      await run('a', 'other', async () => undefined);

      expect(ports).toHaveLength(1);
      expect(factory.createdAgentIds).toEqual(['other']);
    });

    it('should close and disconnect the previous CEO port when the agent changes', async () => {
      await run('a', 'first', async (port) => {
        (port as StubAgentPort).connected = true;
      });

      let current: unknown;
      await run('a', 'second', async (port) => {
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
      await run('a', 'first', async () => undefined);
      ports[0]!.closeSession = async () => {
        throw new Error('close failed');
      };
      ports[0]!.disconnect = async () => {
        throw new Error('disconnect failed');
      };

      await expect(run('a', 'second', async port => port.agentName)).resolves.toBe('second');
      expect(runtime.getCeoPort('a')).toBe(ports[1]);
    });

    it('should start the next turn when creating the CEO port fails', async () => {
      const failingFactory = new StubAgentPortFactory((agentId) => {
        if (agentId === 'broken') {
          throw new Error('cannot create');
        }
        return buildTrackedFactory().create(agentId);
      });
      runtime = new ConversationRuntimeService(failingFactory, toolSessions, new StubRuntimeSettings({ SESSION_IDLE_TIMEOUT_MS: IDLE_MS }));

      await expect(run('a', 'broken', async () => 'never')).rejects.toThrow('cannot create');
      await expect(run('a', 'fine', async port => port.agentName)).resolves.toBe('fine');
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
      runtime = new ConversationRuntimeService(factory, toolSessions, new StubRuntimeSettings({ SESSION_IDLE_TIMEOUT_MS: IDLE_MS }));
    };

    /** A turn whose CEO prompt is on its way until `gate` resolves. */
    const startRunningCeo = async (agentId = 'stub') => {
      const gate = deferred();
      const { turn } = runtime.admit('a');
      const running = runtime.runOnCeo('a', turn, agentId, async () => {
        turn.prompting = true;
        await gate.promise;
        turn.prompting = false;
      });
      await rs.advanceTimersByTimeAsync(0);
      return { gate, running, turn };
    };

    it('should inject the text into the CEO prompt in progress and return the port answer', async () => {
      supportSteeringOnCreate();
      const { gate, running, turn } = await startRunningCeo();

      expect(runtime.acceptsSteering('a', turn, 'stub')).toBe(true);
      await expect(runtime.steerCeo('a', turn, 'stub', 'new message')).resolves.toBe(true);

      expect(ports[0]!.steeringPrompts).toEqual(['new message']);
      gate.resolve();
      await running;
    });

    it('should return false when the port does not take the steering into a running prompt', async () => {
      supportSteeringOnCreate();
      const { gate, running, turn } = await startRunningCeo();
      ports[0]!.steeringResult = 'not_running';

      await expect(runtime.steerCeo('a', turn, 'stub', 'new message')).resolves.toBe(false);

      expect(ports[0]!.steeringPrompts).toEqual(['new message']);
      gate.resolve();
      await running;
    });

    it('should return false when the conversation has no CEO port yet', async () => {
      const { turn } = runtime.admit('a');
      turn.prompting = true;

      await expect(runtime.steerCeo('a', turn, 'stub', 'text')).resolves.toBe(false);
      await expect(runtime.steerCeo('unknown', turn, 'stub', 'text')).resolves.toBe(false);
    });

    it('should return false when no CEO prompt is on its way', async () => {
      supportSteeringOnCreate();
      const { gate, running, turn } = await startRunningCeo();
      turn.prompting = false;

      await expect(runtime.steerCeo('a', turn, 'stub', 'text')).resolves.toBe(false);

      expect(ports[0]!.steeringPrompts).toEqual([]);
      gate.resolve();
      await running;
    });

    it('should return false when the running turn was cancelled', async () => {
      supportSteeringOnCreate();
      const { gate, running, turn } = await startRunningCeo();
      await runtime.cancel('a');

      await expect(runtime.steerCeo('a', turn, 'stub', 'text')).resolves.toBe(false);

      expect(ports[0]!.steeringPrompts).toEqual([]);
      gate.resolve();
      await running;
    });

    it('should return false when the CEO runs on a different agent', async () => {
      supportSteeringOnCreate();
      const { gate, running, turn } = await startRunningCeo('first');

      await expect(runtime.steerCeo('a', turn, 'second', 'text')).resolves.toBe(false);

      expect(ports[0]!.steeringPrompts).toEqual([]);
      gate.resolve();
      await running;
    });

    it('should return false when the CEO agent does not support steering', async () => {
      const { gate, running, turn } = await startRunningCeo();

      await expect(runtime.steerCeo('a', turn, 'stub', 'text')).resolves.toBe(false);

      expect(ports[0]!.steeringPrompts).toEqual([]);
      gate.resolve();
      await running;
    });
  });

  describe('active delegations', () => {
    it('should register, find, get, and unregister active delegations', () => {
      const delegatePort = new StubAgentPort();
      const delegation = {
        delegationId: 'd-1',
        role: 'DEVELOPER',
        roleName: 'Developer Agent',
        agentInfo: { roleName: 'Developer Agent', agentName: 'stub' },
        projectName: 'my-app',
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'Build it',
        cwd: '/mock/my-app',
        startedAt: Date.now(),
        agentPort: delegatePort,
        turn: { cancel: rs.fn() } as any,
        control: new DelegationControl({ runId: 'd', summary: 'Summary', contextSince: '' }),
        stop: rs.fn(),
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
        delegationId: 'd-1',
        role: 'DEVELOPER',
        roleName: 'Developer Agent',
        agentInfo: { roleName: 'Developer Agent', agentName: 'stub' },
        projectName: 'backend',
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'Build the API',
        cwd: '/mock/backend',
        startedAt: Date.now(),
        agentPort: new StubAgentPort(),
        turn: { cancel: rs.fn() } as any,
        control: new DelegationControl({ runId: 'd', summary: 'Summary', contextSince: '' }),
        stop: rs.fn(),
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
        delegationId: 'd-1',
        role: 'DEVELOPER',
        roleName: 'Developer Agent',
        agentInfo: { roleName: 'Developer Agent', agentName: 'stub' },
        projectName: 'my-app',
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'Build it',
        cwd: '/mock/my-app',
        startedAt: Date.now(),
        agentPort: delegatePort1,
        turn: { cancel: rs.fn() } as any,
        control: new DelegationControl({ runId: 'd', summary: 'Summary', contextSince: '' }),
        stop: rs.fn(),
      };
      const delegation2 = {
        ...delegation1,
        agentPort: delegatePort2,
        summary: 'Summary',
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
      const cancelTurnMock = rs.fn().mockResolvedValue(undefined);
      const delegation = {
        delegationId: 'd-1',
        role: 'DEVELOPER',
        roleName: 'Developer Agent',
        agentInfo: { roleName: 'Developer Agent', agentName: 'stub' },
        projectName: 'my-app',
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'Build it',
        cwd: '/mock/my-app',
        startedAt: Date.now(),
        agentPort: delegatePort,
        turn: { cancel: cancelTurnMock } as any,
        control: new DelegationControl({ runId: 'd', summary: 'Summary', contextSince: '' }),
        stop: rs.fn(),
      };

      runtime.registerDelegation('a', delegation);

      const gate = deferred();
      const turnDone = run('a', 'stub', async (_port, turn) => {
        await gate.promise;
        turn.throwIfCancelled();
      });
      await rs.advanceTimersByTimeAsync(0);

      await expect(runtime.cancel('a')).resolves.toBe(true);
      expect(cancelTurnMock).toHaveBeenCalled();

      gate.resolve();
      await expect(turnDone).rejects.toBeInstanceOf(PromptCancelledError);
    });

    it('should cancel active delegations concurrently and rethrow if any cancel rejects', async () => {
      const cancelMock1 = rs.fn().mockRejectedValue(new Error('fail 1'));
      const cancelMock2 = rs.fn().mockResolvedValue(undefined);
      runtime.registerDelegation('a', {
        delegationId: 'd-1',
        role: 'DEVELOPER',
        roleName: 'Developer',
        agentInfo: { roleName: 'Developer', agentName: 'stub' },
        projectName: 'app',
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'task',
        cwd: '/mock',
        startedAt: Date.now(),
        agentPort: new StubAgentPort(),
        turn: { cancel: cancelMock1 } as any,
        control: new DelegationControl({ runId: 'd', summary: 'Summary', contextSince: '' }),
        stop: rs.fn(),
      });
      runtime.registerDelegation('a', {
        delegationId: 'd-1',
        role: 'CODE_REVIEWER',
        roleName: 'Reviewer',
        agentInfo: { roleName: 'Reviewer', agentName: 'stub' },
        projectName: null,
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'review',
        cwd: '/mock',
        startedAt: Date.now(),
        agentPort: new StubAgentPort(),
        turn: { cancel: cancelMock2 } as any,
        control: new DelegationControl({ runId: 'd', summary: 'Summary', contextSince: '' }),
        stop: rs.fn(),
      });

      await expect(runtime.cancel('a')).rejects.toThrow('fail 1');
      expect(cancelMock1).toHaveBeenCalled();
      expect(cancelMock2).toHaveBeenCalled();
    });

    it('should cancel active delegations concurrently when all succeed', async () => {
      const cancelMock1 = rs.fn().mockResolvedValue(undefined);
      const cancelMock2 = rs.fn().mockResolvedValue(undefined);
      runtime.registerDelegation('a', {
        delegationId: 'd-1',
        role: 'DEVELOPER',
        roleName: 'Developer',
        agentInfo: { roleName: 'Developer', agentName: 'stub' },
        projectName: 'app',
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'task',
        cwd: '/mock',
        startedAt: Date.now(),
        agentPort: new StubAgentPort(),
        turn: { cancel: cancelMock1 } as any,
        control: new DelegationControl({ runId: 'd', summary: 'Summary', contextSince: '' }),
        stop: rs.fn(),
      });
      runtime.registerDelegation('a', {
        delegationId: 'd-1',
        role: 'CODE_REVIEWER',
        roleName: 'Reviewer',
        agentInfo: { roleName: 'Reviewer', agentName: 'stub' },
        projectName: null,
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'review',
        cwd: '/mock',
        startedAt: Date.now(),
        agentPort: new StubAgentPort(),
        turn: { cancel: cancelMock2 } as any,
        control: new DelegationControl({ runId: 'd', summary: 'Summary', contextSince: '' }),
        stop: rs.fn(),
      });

      await expect(runtime.cancel('a')).resolves.toBe(true);
      expect(cancelMock1).toHaveBeenCalled();
      expect(cancelMock2).toHaveBeenCalled();
    });

    it('should disconnect active delegations on shutdown', async () => {
      const delegatePort = new StubAgentPort();
      delegatePort.connected = true;
      const delegation = {
        delegationId: 'd-1',
        role: 'DEVELOPER',
        roleName: 'Developer Agent',
        agentInfo: { roleName: 'Developer Agent', agentName: 'stub' },
        projectName: 'my-app',
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'Build it',
        cwd: '/mock/my-app',
        startedAt: Date.now(),
        agentPort: delegatePort,
        turn: { cancel: rs.fn() } as any,
        control: new DelegationControl({ runId: 'd', summary: 'Summary', contextSince: '' }),
        stop: rs.fn(),
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
        delegationId: 'd-1',
        role: 'DEVELOPER',
        roleName: 'Developer Agent',
        agentInfo: { roleName: 'Developer Agent', agentName: 'stub' },
        projectName: 'my-app',
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'Build it',
        cwd: '/mock/my-app',
        startedAt: Date.now(),
        agentPort: delegatePort,
        turn: { cancel: rs.fn() } as any,
        control: new DelegationControl({ runId: 'd', summary: 'Summary', contextSince: '' }),
        stop: rs.fn(),
      };

      await run('a', 'stub', async () => undefined);
      runtime.registerDelegation('a', delegation);
      await rs.advanceTimersByTimeAsync(IDLE_MS * 2);
      expect(ports[0]!.closeSessionCalls).toBe(0);

      runtime.unregisterDelegation('a', delegation);
      await rs.advanceTimersByTimeAsync(IDLE_MS);
      expect(ports[0]!.closeSessionCalls).toBe(1);
    });

    it('should schedule expiration when the turn ends and no delegation is active', async () => {
      await run('a', 'stub', async () => undefined);
      await rs.advanceTimersByTimeAsync(IDLE_MS);
      expect(ports[0]!.closeSessionCalls).toBe(1);
    });

    it('should close sessions and disconnect active delegations on expiration', async () => {
      const delegatePort = new StubAgentPort();
      delegatePort.connected = true;
      const delegation = {
        delegationId: 'd-1',
        role: 'DEVELOPER',
        roleName: 'Developer Agent',
        agentInfo: { roleName: 'Developer Agent', agentName: 'stub' },
        projectName: 'my-app',
        artifactId: null,
        summary: 'Summary',
        taskSpec: 'Build it',
        cwd: '/mock/my-app',
        startedAt: Date.now(),
        agentPort: delegatePort,
        turn: { cancel: rs.fn() } as any,
        control: new DelegationControl({ runId: 'd', summary: 'Summary', contextSince: '' }),
        stop: rs.fn(),
      };

      runtime.registerDelegation('a', delegation);
      await (runtime as any).expire('a', (runtime as any).getOrCreate('a'));

      expect(delegatePort.closeSessionCalls).toBe(1);
      expect(delegatePort.connected).toBe(false);
      expect(runtime.getActiveDelegations('a')).toEqual([]);
    });
  });

  describe('agent receipts', () => {
    it('should keep the receipts of each conversation in order until they are acknowledged', () => {
      runtime.addAgentReceipt('a', 'first');
      runtime.addAgentReceipt('a', 'second');
      runtime.addAgentReceipt('b', 'other');

      runtime.acknowledgeAgentReceipts('a', 1);

      expect(runtime.pendingAgentReceipts('a')).toEqual(['second']);
      expect(runtime.pendingAgentReceipts('b')).toEqual(['other']);
    });

    it('should leave none pending once all of them are acknowledged', () => {
      runtime.addAgentReceipt('a', 'first');

      runtime.acknowledgeAgentReceipts('a', 1);
      runtime.acknowledgeAgentReceipts('unknown', 1);

      expect(runtime.pendingAgentReceipts('a')).toEqual([]);
      expect(runtime.pendingAgentReceipts('unknown')).toEqual([]);
    });
  });

  describe('CEO notices', () => {
    it('should have no pending notices for a conversation that has none', () => {
      expect(runtime.pendingCeoNotices('a')).toEqual([]);
    });

    it('should keep the notices of a conversation in the order they were added', () => {
      runtime.addCeoNotice('a', 'first');
      runtime.addCeoNotice('a', 'second');
      runtime.addCeoNotice('b', 'other');

      expect(runtime.pendingCeoNotices('a')).toEqual(['first', 'second']);
      expect(runtime.pendingCeoNotices('b')).toEqual(['other']);
    });

    it('should drop only the acknowledged notices so later ones stay pending', () => {
      runtime.addCeoNotice('a', 'first');
      runtime.addCeoNotice('a', 'second');
      runtime.addCeoNotice('a', 'third');

      runtime.acknowledgeCeoNotices('a', 2);

      expect(runtime.pendingCeoNotices('a')).toEqual(['third']);
    });

    it('should leave none pending once all of them are acknowledged', () => {
      runtime.addCeoNotice('a', 'first');
      runtime.addCeoNotice('a', 'second');

      runtime.acknowledgeCeoNotices('a', 2);

      expect(runtime.pendingCeoNotices('a')).toEqual([]);
    });

    it('should keep every notice when none was delivered', () => {
      runtime.addCeoNotice('a', 'first');

      runtime.acknowledgeCeoNotices('a', 0);
      runtime.acknowledgeCeoNotices('unknown', 1);

      expect(runtime.pendingCeoNotices('a')).toEqual(['first']);
      expect(runtime.pendingCeoNotices('unknown')).toEqual([]);
    });

    it('should keep the notices after the idle timeout expires the runtime', async () => {
      await run('a', 'stub', async () => undefined);
      runtime.addCeoNotice('a', 'first');

      await rs.advanceTimersByTimeAsync(IDLE_MS + 1);

      expect(runtime.getCeoPort('a')).toBeUndefined();
      expect(runtime.pendingCeoNotices('a')).toEqual(['first']);
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
      delegationId: 'd-1',
      role: 'DEVELOPER',
      roleName: 'Developer',
      agentInfo: { roleName: 'Developer', agentName: 'stub' },
      projectName: null,
      artifactId: null,
      summary: 'Summary',
      taskSpec: 'task',
      cwd: '/mock',
      startedAt: Date.now(),
      agentPort: port,
      turn: { cancel: rs.fn() } as any,
      control: new DelegationControl({ runId: 'd', summary: 'Summary', contextSince: '' }),
      stop: rs.fn(),
    });

    it('should tear down every agent on shutdown even when disconnecting fails', async () => {
      const failingFactory = new StubAgentPortFactory(failingPort);
      runtime = new ConversationRuntimeService(failingFactory, toolSessions, new StubRuntimeSettings({ SESSION_IDLE_TIMEOUT_MS: IDLE_MS }));
      await run('a', 'stub', async () => undefined);
      registerDelegationOn(failingPort());

      await expect(runtime.onApplicationShutdown()).resolves.toBeUndefined();
      expect(runtime.getActiveDelegations('a')).toEqual([]);
    });

    it('should expire an idle session even when closing its agents fails', async () => {
      const failingFactory = new StubAgentPortFactory(failingPort);
      runtime = new ConversationRuntimeService(failingFactory, toolSessions, new StubRuntimeSettings({ SESSION_IDLE_TIMEOUT_MS: IDLE_MS }));
      await run('a', 'stub', async () => undefined);
      registerDelegationOn(failingPort());
      runtime.unregisterDelegation('unknown', runtime.getActiveDelegations('a')[0]!);

      await (runtime as any).expire('a', (runtime as any).getOrCreate('a'));

      expect(runtime.getActiveDelegations('a')).toEqual([]);
      expect(runtime.getCeoPort('a')).toBeUndefined();
    });
  });
});
