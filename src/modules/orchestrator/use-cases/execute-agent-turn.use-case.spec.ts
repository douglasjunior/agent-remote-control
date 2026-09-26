import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import { type AgentUpdate, PromptCancelledError } from '../../agent/ports/agent.port.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import type { DelegationEvent } from '../models/delegation-event.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';
import { DelegationDetectorService } from '../services/delegation-detector.service.js';
import { InMemorySessionStoreFake } from '../testing/in-memory-session-store.fake.js';
import { buildSessionContext } from '../testing/session-context.fixture.js';
import { StubAgentSettingsStore } from '../testing/stub-agent-settings-store.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { ExecuteAgentTurnUseCase } from './execute-agent-turn.use-case.js';


class StubAgentRegistryPort implements IAgentRegistryPort {
  getDefaultModel = vi.fn().mockReturnValue('mock-model-v1');
  getSystemPrompt = vi.fn().mockReturnValue('Mock system prompt.');
  getDisplayName = vi.fn((role: string) => role);
  hasRole = vi.fn((role: string) => ['CEO', 'DEVELOPER'].includes(role));
}

class StubWorkspacePort implements IWorkspacePort {
  getBaseDirectory = vi.fn().mockReturnValue('/mock/workspace');
  resolveRepositoryPath = vi.fn().mockReturnValue('/mock/workspace/my-app');
  ensureDirectory = vi.fn().mockResolvedValue(undefined);
  registerRepository = vi.fn();
  getRepository = vi.fn();
  listRepositories = vi.fn();
  hasRepository = vi.fn();
}

function textChunk(text: string): AgentUpdate {
  return { kind: 'text', text };
}

describe('ExecuteAgentTurnUseCase', () => {
  let useCase: ExecuteAgentTurnUseCase;
  let stubAgentPort: StubAgentPort;
  let delegateStubPort: StubAgentPort;
  let sessionStore: InMemorySessionStoreFake;
  let settingsStore: StubAgentSettingsStore;
  let agentRegistry: StubAgentRegistryPort;
  let workspacePort: StubWorkspacePort;
  let delegationDetector: DelegationDetectorService;
  let runtime: ConversationRuntimeService;

  beforeEach(() => {
    stubAgentPort = new StubAgentPort();
    delegateStubPort = new StubAgentPort();
    sessionStore = new InMemorySessionStoreFake();
    settingsStore = new StubAgentSettingsStore();
    agentRegistry = new StubAgentRegistryPort();
    workspacePort = new StubWorkspacePort();
    delegationDetector = new DelegationDetectorService();

    let createCount = 0;
    const portFactory: IAgentPortFactory = {
      create: () => {
        createCount++;
        return createCount === 1 ? stubAgentPort : delegateStubPort;
      },
    };

    runtime = new ConversationRuntimeService(portFactory, 60_000);
    useCase = new ExecuteAgentTurnUseCase(
      portFactory,
      sessionStore,
      agentRegistry,
      workspacePort,
      settingsStore,
      delegationDetector,
      runtime,
    );
  });

  const turnRequest = (overrides: Partial<TurnRequest> = {}): TurnRequest => ({
    channelId: 'ch-1',
    userId: 'user-1',
    prompt: 'Hi',
    workspacePath: '/mock/workspace',
    agentRole: 'CEO',
    ...overrides,
  });


  it('should return the CEO response when there is no marker', async () => {
    stubAgentPort.mockResponses = ['Hello world!'];

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('completed');
    expect(result.response).toBe('Hello world!');
    expect(stubAgentPort.connectCalls).toBe(1);
    expect(stubAgentPort.createSessionCalls).toEqual(['/mock/workspace']);
    expect(stubAgentPort.configCalls).toEqual([{ modelId: 'mock-model-v1' }]);
  });

  it('should return the summary before the done marker', async () => {
    stubAgentPort.mockResponses = ['All set.\n[DONE]'];

    const result = await useCase.execute(turnRequest());

    expect(result).toEqual({
      sessionId: expect.any(String),
      response: 'All set.',
      status: 'completed',
      agentInfo: { roleName: 'CEO', agentName: 'stub' },
    });
  });

  it('should report the token usage of the last CEO round', async () => {
    const usage = { totalTokens: 165, inputTokens: 100, outputTokens: 65 };
    stubAgentPort.usageToReturn = usage;
    stubAgentPort.mockResponses = ['Hi.'];

    const result = await useCase.execute(turnRequest());

    expect(result.usage).toEqual(usage);
  });

  it('should omit the token usage when collecting it fails', async () => {
    stubAgentPort.usageErrorToThrow = new Error('usage unavailable');
    stubAgentPort.mockResponses = ['Hi.'];

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('completed');
    expect(result.usage).toBeUndefined();
  });

  it('should delegate to a new agent in the project folder and feed its result back to the CEO', async () => {
    stubAgentPort.mockResponses = ['Implement login.\n[DELEGATE:DEVELOPER:my-app]', 'Done.\n[DONE]'];
    delegateStubPort.mockResponses = ['Login implemented.'];
    agentRegistry.getSystemPrompt.mockImplementation((role: string) => `${role} prompt`);

    const result = await useCase.execute(turnRequest({ prompt: 'Add login' }));

    expect(result.response).toBe('Done.');
    expect(workspacePort.resolveRepositoryPath).toHaveBeenCalledWith('my-app');
    expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/my-app']);
    expect(delegateStubPort.promptCalls).toEqual(['DEVELOPER prompt\n\nImplement login.']);
    expect(stubAgentPort.promptCalls).toEqual([
      'CEO prompt\n\nAdd login',
      '[AGENT_RESULT:DEVELOPER]\nLogin implemented.',
    ]);
    expect(delegateStubPort.closeSessionCalls).toBe(1);
    expect(delegateStubPort.connected).toBe(false);
  });

  it('should run the delegate in the request workspace when no project is given', async () => {
    stubAgentPort.mockResponses = ['Review it.\n[DELEGATE:DEVELOPER]', 'Ok.\n[DONE]'];
    delegateStubPort.mockResponses = ['Reviewed.'];

    await useCase.execute(turnRequest());

    expect(workspacePort.resolveRepositoryPath).not.toHaveBeenCalled();
    expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace']);
  });

  it('should notify when a delegation starts and finishes', async () => {
    stubAgentPort.mockResponses = ['Go.\n[DELEGATE:DEVELOPER:my-app]', 'Ok.\n[DONE]'];
    delegateStubPort.mockResponses = ['Done.'];
    agentRegistry.getDisplayName.mockImplementation((role: string) => `${role} name`);
    const events: DelegationEvent[] = [];

    await useCase.execute(turnRequest({ onDelegation: event => events.push(event) }));

    const delegation = { round: 1, role: 'DEVELOPER', roleName: 'DEVELOPER name', projectName: 'my-app' };
    expect(events).toEqual([
      { ...delegation, phase: 'started' },
      { ...delegation, phase: 'finished' },
    ]);
  });

  it('should ensure each agent working directory exists before creating its session', async () => {
    stubAgentPort.mockResponses = ['Go.\n[DELEGATE:DEVELOPER:my-app]', 'Ok.\n[DONE]'];
    delegateStubPort.mockResponses = ['Done.'];

    await useCase.execute(turnRequest());

    expect(workspacePort.ensureDirectory.mock.calls).toEqual([
      ['/mock/workspace'],
      ['/mock/workspace/my-app'],
    ]);
  });

  it('should fail the turn without creating a session when the directory cannot be prepared', async () => {
    workspacePort.ensureDirectory.mockRejectedValue(new Error('Path is outside the workspace directory: /x'));

    const result = await useCase.execute(turnRequest({ workspacePath: '/x' }));

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('Path is outside the workspace directory: /x');
    expect(stubAgentPort.createSessionCalls).toHaveLength(0);
  });

  it('should return failed when max delegation rounds are exceeded', async () => {
    stubAgentPort.mockResponses = Array(15).fill('Delegating...\n[DELEGATE:DEVELOPER:my-app]');
    delegateStubPort.mockResponses = Array(15).fill('I did it.');

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('Max delegation rounds exceeded.');
    expect(stubAgentPort.promptCalls).toHaveLength(10);
    expect(delegateStubPort.promptCalls).toHaveLength(9);
  });

  describe('delegation repair', () => {
    it('should send a repair prompt with the reason and delegate once the CEO fixes the marker', async () => {
      stubAgentPort.mockResponses = [
        'Cloning it. [DELEGATE:DEVELOPER:my-app]',
        'Clone the repo.\n[DELEGATE:DEVELOPER:my-app]',
        'Cloned.\n[DONE]',
      ];
      delegateStubPort.mockResponses = ['Repo cloned.'];

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'Cloned.' });
      expect(stubAgentPort.promptCalls[1]).toContain('[DELEGATION_ERROR]');
      expect(stubAgentPort.promptCalls[1]).toContain('alone on its own line');
      expect(delegateStubPort.promptCalls).toEqual(['Mock system prompt.\n\nClone the repo.']);
    });

    it('should repair a delegation to a role outside the team', async () => {
      stubAgentPort.mockResponses = ['Test it.\n[DELEGATE:QA:my-app]', 'Ok, I will ask you first.'];

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'Ok, I will ask you first.' });
      expect(stubAgentPort.promptCalls[1]).toContain('Unknown role "QA"');
      expect(delegateStubPort.promptCalls).toHaveLength(0);
    });

    it('should repair a delegation from the CEO to itself', async () => {
      stubAgentPort.mockResponses = ['Plan it.\n[DELEGATE:CEO]', 'Planned.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain('Unknown role "CEO"');
    });

    it('should repair a delegation to a project folder outside the workspaces root', async () => {
      workspacePort.resolveRepositoryPath.mockImplementationOnce(() => {
        throw new Error('Path is outside the workspace directory: /etc');
      });
      stubAgentPort.mockResponses = ['Go.\n[DELEGATE:DEVELOPER:../../etc]', 'Go.\n[DELEGATE:DEVELOPER:my-app]', 'Ok.\n[DONE]'];
      delegateStubPort.mockResponses = ['Done.'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(stubAgentPort.promptCalls[1]).toContain(
        'Invalid project folder "../../etc": Path is outside the workspace directory: /etc.',
      );
      expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/my-app']);
    });

    it('should stringify non-Error failures when resolving the project folder', async () => {
      workspacePort.resolveRepositoryPath.mockImplementationOnce(() => {
        throw 'bad path';
      });
      stubAgentPort.mockResponses = ['Go.\n[DELEGATE:DEVELOPER:x]', 'Never mind.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain('Invalid project folder "x": bad path.');
    });

    it('should fail the turn when the repaired response is still invalid', async () => {
      stubAgentPort.mockResponses = ['Go [DONE] now.', 'Still [DONE] wrong.'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('failed');
      expect(result.response).toBe('Still [DONE] wrong.');
      expect(result.errorMessage).toBe(
        'Invalid CEO response: The marker must be alone on its own line, with no other text on that line.',
      );
      expect(stubAgentPort.promptCalls).toHaveLength(2);
    });
  });

  it('should send the system prompt only when the CEO ACP session is created', async () => {
    stubAgentPort.mockResponses = ['First.', 'Second.'];

    await useCase.execute(turnRequest());
    await useCase.execute(turnRequest({ prompt: 'Again' }));

    expect(stubAgentPort.createSessionCalls).toHaveLength(1);
    expect(stubAgentPort.promptCalls).toEqual(['Mock system prompt.\n\nHi', 'Again']);
  });

  it('should send the system prompt again when the first turn failed before the session existed', async () => {
    stubAgentPort.errorToThrowOnCreateSession = new Error('Internal error');
    const failed = await useCase.execute(turnRequest());
    stubAgentPort.errorToThrowOnCreateSession = null;
    stubAgentPort.mockResponses = ['Hello.'];

    const result = await useCase.execute(turnRequest({ prompt: 'Hello?' }));

    expect(failed.status).toBe('failed');
    expect(result.sessionId).toBe(failed.sessionId);
    expect(stubAgentPort.promptCalls).toEqual(['Mock system prompt.\n\nHello?']);
  });

  it('should isolate agent ports between different threads', async () => {
    stubAgentPort.mockResponses = ['A.'];
    delegateStubPort.mockResponses = ['B.'];

    await useCase.execute(turnRequest({ threadId: 'th-a', prompt: 'a' }));
    await useCase.execute(turnRequest({ threadId: 'th-b', prompt: 'b' }));

    expect(stubAgentPort.promptCalls).toEqual(['Mock system prompt.\n\na']);
    expect(delegateStubPort.promptCalls).toEqual(['Mock system prompt.\n\nb']);
  });

  it('should queue a second message of the same thread until the current turn finishes', async () => {
    let releaseFirst: () => void = () => undefined;
    const firstStarted = new Promise<void>((started) => {
      stubAgentPort.prompt = async function* (this: StubAgentPort, text: string) {
        this.promptCalls.push(text);
        if (this.promptCalls.length === 1) {
          started();
          await new Promise<void>((release) => {
            releaseFirst = release;
          });
        }
        yield textChunk(`reply to ${text}`);
      };
    });
    const onQueued = vi.fn();

    const first = useCase.execute(turnRequest({ threadId: 'th-1', prompt: 'one' }));
    await firstStarted;
    const second = useCase.execute(turnRequest({ threadId: 'th-1', prompt: 'two', onQueued }));
    await new Promise(resolve => setImmediate(resolve));

    expect(onQueued).toHaveBeenCalledTimes(1);
    expect(stubAgentPort.promptCalls).toHaveLength(1);

    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.response).toBe('reply to Mock system prompt.\n\none');
    expect(secondResult.response).toBe('reply to two');
  });

  it('should create a single session when two messages start a new conversation at once', async () => {
    let releaseFirst: () => void = () => undefined;
    const firstStarted = new Promise<void>((started) => {
      stubAgentPort.prompt = async function* (this: StubAgentPort, text: string) {
        this.promptCalls.push(text);
        if (this.promptCalls.length === 1) {
          started();
          await new Promise<void>((release) => {
            releaseFirst = release;
          });
        }
        yield textChunk('ok');
      };
    });

    const first = useCase.execute(turnRequest({ prompt: 'one' }));
    const second = useCase.execute(turnRequest({ prompt: 'two' }));
    await firstStarted;
    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(secondResult.sessionId).toBe(firstResult.sessionId);
    expect(stubAgentPort.promptCalls).toEqual(['Mock system prompt.\n\none', 'two']);
  });

  it('should return failed when the session cannot be saved', async () => {
    sessionStore.saveSession = async () => {
      throw new Error('EACCES: permission denied');
    };

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('EACCES: permission denied');
    expect(result.sessionId).toBeUndefined();
    expect(stubAgentPort.promptCalls).toHaveLength(0);
  });

  it('should honour a cancellation requested while the delegate is still connecting', async () => {
    stubAgentPort.mockResponses = ['Go.\n[DELEGATE:DEVELOPER:my-app]'];
    let finishConnect: () => void = () => undefined;
    const connecting = new Promise<void>((started) => {
      delegateStubPort.connect = async () => {
        started();
        await new Promise<void>((resolve) => {
          finishConnect = resolve;
        });
      };
    });

    const turn = useCase.execute(turnRequest());
    await connecting;

    await expect(runtime.cancel('ch-1:')).resolves.toBe(true);
    finishConnect();
    const result = await turn;

    expect(result.status).toBe('cancelled');
    expect(delegateStubPort.promptCalls).toHaveLength(0);
    expect(delegateStubPort.createSessionCalls).toHaveLength(0);
  });

  it('should close the delegate and return cancelled when the delegate prompt is cancelled', async () => {
    stubAgentPort.mockResponses = ['Go.\n[DELEGATE:DEVELOPER:my-app]'];
    delegateStubPort.promptErrorToThrow = new PromptCancelledError();

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('cancelled');
    expect(delegateStubPort.closeSessionCalls).toBe(1);
    expect(delegateStubPort.connected).toBe(false);
  });

  it('should not report a finished delegation when the delegate is cancelled', async () => {
    stubAgentPort.mockResponses = ['Go.\n[DELEGATE:DEVELOPER:my-app]'];
    delegateStubPort.promptErrorToThrow = new PromptCancelledError();
    const phases: string[] = [];

    await useCase.execute(turnRequest({ onDelegation: event => phases.push(event.phase) }));

    expect(phases).toEqual(['started']);
  });

  it('should stream text chunks and forward activities from every agent', async () => {
    stubAgentPort.mockResponses = ['Go.\n[DELEGATE:DEVELOPER:my-app]', 'Ok.\n[DONE]'];
    delegateStubPort.prompt = async function* (this: StubAgentPort) {
      this.emitActivity({ kind: 'thought', id: 't', text: 'thinking' });
      yield textChunk('first ');
      yield textChunk('');
      yield textChunk('second');
    };
    const onActivity = vi.fn();
    const onTextChunk = vi.fn();

    await useCase.execute(turnRequest({ onActivity, onTextChunk }));

    expect(onActivity).toHaveBeenCalledWith({ kind: 'thought', id: 't', text: 'thinking' });
    expect(onTextChunk).toHaveBeenCalledWith('first ');
    expect(onTextChunk).toHaveBeenCalledWith('second');
    expect(onTextChunk).toHaveBeenCalledTimes(4);
    expect(stubAgentPort.promptCalls[1]).toBe('[AGENT_RESULT:DEVELOPER]\nfirst second');
    expect(delegateStubPort.activityListeners).toHaveLength(0);
  });

  it('should skip model configuration when the role has no default model', async () => {
    agentRegistry.getDefaultModel.mockReturnValue(undefined);
    stubAgentPort.mockResponses = ['Hi.'];

    await useCase.execute(turnRequest());

    expect(stubAgentPort.configCalls).toHaveLength(0);
  });

  it('should return cancelled when PromptCancelledError is thrown', async () => {
    stubAgentPort.promptErrorToThrow = new PromptCancelledError();

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('cancelled');
  });

  it('should treat errors named PromptCancelledError as cancellation', async () => {
    const error = new Error('cancelled');
    error.name = 'PromptCancelledError';
    stubAgentPort.promptErrorToThrow = error;

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('cancelled');
  });

  it('should return failed with the error message when a generic error is thrown', async () => {
    stubAgentPort.promptErrorToThrow = new Error('Generic error');

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('Generic error');
  });

  it('should stringify non-Error failures', async () => {
    stubAgentPort.connect = async () => {
      throw 'raw failure';
    };

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('raw failure');
  });

  describe('agent session recovery', () => {
    const persistedSession = () =>
      sessionStore.saveSession(buildSessionContext({ agentSessions: [{ role: 'CEO', sessionId: 'conv-old' }] }));
    const storedAgentSessions = async () => (await sessionStore.findSession('ch-1'))?.agentSessions;

    it('should persist the agent session id created for a new conversation', async () => {
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest());

      expect(await storedAgentSessions()).toEqual([{ role: 'CEO', sessionId: 'session-1' }]);
    });

    it('should resume the persisted agent session without resending the system prompt', async () => {
      await persistedSession();
      stubAgentPort.mockResponses = ['Welcome back.'];

      const result = await useCase.execute(turnRequest({ prompt: 'Continue' }));

      expect(result.sessionId).toBe('sess-1');
      expect(stubAgentPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace', sessionId: 'conv-old' }]);
      expect(stubAgentPort.createSessionCalls).toHaveLength(0);
      expect(stubAgentPort.promptCalls).toEqual(['Continue']);
      expect(await storedAgentSessions()).toEqual([{ role: 'CEO', sessionId: 'conv-old' }]);
    });

    it('should create a new session and store its id when the load fails', async () => {
      await persistedSession();
      stubAgentPort.loadSessionResult = false;
      stubAgentPort.mockResponses = ['Fresh start.'];

      await useCase.execute(turnRequest({ prompt: 'Continue' }));

      expect(stubAgentPort.createSessionCalls).toEqual(['/mock/workspace']);
      expect(stubAgentPort.promptCalls).toEqual(['Mock system prompt.\n\nContinue']);
      expect(await storedAgentSessions()).toEqual([{ role: 'CEO', sessionId: 'session-1' }]);
    });

    it('should persist the delegate session id alongside the CEO session id', async () => {
      stubAgentPort.mockResponses = ['Go.\n[DELEGATE:DEVELOPER:my-app]', 'Ok.\n[DONE]'];
      delegateStubPort.mockResponses = ['Done.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.loadSessionCalls).toHaveLength(0);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', sessionId: 'session-1' },
        { role: 'DEVELOPER', sessionId: 'session-1' },
      ]);
    });

    it('should resume the stored delegate session without resending the system prompt', async () => {
      await sessionStore.saveSession(buildSessionContext({
        agentSessions: [{ role: 'CEO', sessionId: 'conv-old' }, { role: 'DEVELOPER', sessionId: 'dev-old' }],
      }));
      stubAgentPort.mockResponses = ['Fix it.\n[DELEGATE:DEVELOPER:my-app]', 'Ok.\n[DONE]'];
      delegateStubPort.mockResponses = ['Fixed.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace/my-app', sessionId: 'dev-old' }]);
      expect(delegateStubPort.createSessionCalls).toHaveLength(0);
      expect(delegateStubPort.promptCalls).toEqual(['Fix it.']);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', sessionId: 'conv-old' },
        { role: 'DEVELOPER', sessionId: 'dev-old' },
      ]);
    });

    it('should resume the delegate session created in an earlier round of the same turn', async () => {
      stubAgentPort.mockResponses = [
        'Build it.\n[DELEGATE:DEVELOPER:my-app]',
        'Now test it.\n[DELEGATE:DEVELOPER:my-app]',
        'Ok.\n[DONE]',
      ];
      delegateStubPort.mockResponses = ['Built.', 'Tested.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/my-app']);
      expect(delegateStubPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace/my-app', sessionId: 'session-1' }]);
      expect(delegateStubPort.promptCalls).toEqual(['Mock system prompt.\n\nBuild it.', 'Now test it.']);
    });

    it('should replace only the delegate role session when its load fails', async () => {
      await sessionStore.saveSession(buildSessionContext({
        agentSessions: [
          { role: 'CEO', sessionId: 'conv-old' },
          { role: 'DEVELOPER', sessionId: 'dev-old' },
          { role: 'REVIEWER', sessionId: 'rev-old' },
        ],
      }));
      delegateStubPort.loadSessionResult = false;
      stubAgentPort.mockResponses = ['Go.\n[DELEGATE:DEVELOPER:my-app]', 'Ok.\n[DONE]'];
      delegateStubPort.mockResponses = ['Done.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.promptCalls).toEqual(['Mock system prompt.\n\nGo.']);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', sessionId: 'conv-old' },
        { role: 'REVIEWER', sessionId: 'rev-old' },
        { role: 'DEVELOPER', sessionId: 'session-1' },
      ]);
    });

    it('should disconnect the CEO agent when the turn fails', async () => {
      stubAgentPort.promptErrorToThrow = new Error('agent crashed');
      stubAgentPort.currentSessionId = 'session-live';

      await useCase.execute(turnRequest());

      expect(stubAgentPort.connected).toBe(false);
      expect(stubAgentPort.currentSessionId).toBeUndefined();
    });

    it('should keep the CEO agent connected when the turn is cancelled', async () => {
      stubAgentPort.promptErrorToThrow = new PromptCancelledError();

      await useCase.execute(turnRequest());

      expect(stubAgentPort.connected).toBe(true);
    });
  });

  describe('agent settings', () => {
    const settings = {
      modelId: 'm-fast',
      modelName: 'Fast Model',
      effortId: 'high',
      effortName: 'High',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('should apply the global settings to the CEO and to delegates', async () => {
      settingsStore.settings = settings;
      stubAgentPort.mockResponses = ['Go.\n[DELEGATE:DEVELOPER:my-app]', 'Ok.\n[DONE]'];
      delegateStubPort.mockResponses = ['Done.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.configCalls).toContainEqual({ modelId: 'm-fast', effortId: 'high' });
      expect(delegateStubPort.configCalls).toEqual([{ modelId: 'm-fast', effortId: 'high' }]);
      expect(agentRegistry.getDefaultModel).not.toHaveBeenCalled();
    });

    it('should omit the effort when the selected model has none', async () => {
      settingsStore.settings = { ...settings, effortId: null, effortName: null };
      stubAgentPort.mockResponses = ['Hi.'];

      const result = await useCase.execute(turnRequest());

      expect(stubAgentPort.configCalls).toEqual([{ modelId: 'm-fast', effortId: undefined }]);
      expect(result.agentInfo).toEqual({
        roleName: 'CEO',
        agentName: 'stub',
        modelName: 'Fast Model',
        effortName: undefined,
      });
    });

    it('should report the configured model and effort on every status', async () => {
      settingsStore.settings = settings;
      const expected = {
        roleName: 'CEO',
        agentName: 'stub',
        modelName: 'Fast Model',
        effortName: 'High',
      };

      stubAgentPort.mockResponses = ['Hi.'];
      const completed = await useCase.execute(turnRequest({ threadId: 'a' }));
      stubAgentPort.promptErrorToThrow = new PromptCancelledError();
      const cancelled = await useCase.execute(turnRequest({ threadId: 'a' }));
      stubAgentPort.promptErrorToThrow = new Error('boom');
      const failed = await useCase.execute(turnRequest({ threadId: 'a' }));

      expect(completed.agentInfo).toEqual(expected);
      expect(cancelled.agentInfo).toEqual(expected);
      expect(failed.agentInfo).toEqual(expected);
    });

    it('should report the agent current model when there are no settings', async () => {
      stubAgentPort.modelsToReturn = {
        availableModels: [
          { modelId: 'm1', name: 'm1', displayName: 'Model One' },
          { modelId: 'm2', name: 'm2', displayName: 'Model Two' },
        ],
        currentModelId: 'm2',
      };
      stubAgentPort.mockResponses = ['Hi.'];

      const result = await useCase.execute(turnRequest());

      expect(result.agentInfo?.modelName).toBe('Model Two');
      expect(result.agentInfo?.effortName).toBeUndefined();
    });
  });
});
