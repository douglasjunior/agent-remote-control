import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AgentUpdate, PromptCancelledError } from '../../agent/ports/agent.port.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import type { AgentSettings } from '../models/agent-settings.model.js';
import type { DelegationEvent } from '../models/delegation-event.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { QuestionPrompt } from '../models/user-question.model.js';
import {
  type DelegationContract,
  IAgentRegistryPort,
} from '../ports/agent-registry.port.js';
import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';
import { DelegationDetectorService } from '../services/delegation-detector.service.js';
import { QuestionParserService } from '../services/question-parser.service.js';
import { UserQuestionQueueService } from '../services/user-question-queue.service.js';
import { InMemorySessionStoreFake } from '../testing/in-memory-session-store.fake.js';
import { buildSessionContext } from '../testing/session-context.fixture.js';
import { StubAgentPortFactory } from '../testing/stub-agent-port-factory.js';
import { StubAgentSettingsStore } from '../testing/stub-agent-settings-store.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { ExecuteAgentTurnUseCase } from './execute-agent-turn.use-case.js';


vi.mock('node:fs', () => ({
  statSync: vi.fn().mockReturnValue({ isFile: () => false }),
}));

const { statSync } = await import('node:fs');


class StubAgentRegistryPort implements IAgentRegistryPort {
  getDefaultModel = vi.fn().mockReturnValue('mock-model-v1');
  getSystemPrompt = vi.fn().mockReturnValue('Mock system prompt.');
  getDisplayName = vi.fn((role: string) => role);
  hasRole = vi.fn((role: string) => ['CEO', 'DEVELOPER', 'CODE_REVIEWER'].includes(role));
  getDefaultSessionMode = vi.fn((role: string) => (role === 'CODE_REVIEWER' ? 'new' : 'resume'));
  getDelegationContract = vi.fn(
    (_role: string) => ({ project: 'optional', sessionMode: 'overridable' }) as DelegationContract,
  );

  getTurnReminder = vi.fn().mockReturnValue('');
  isSystemPromptEveryTurn = vi.fn().mockReturnValue(false);
  getWorkspaceFiles = vi.fn().mockReturnValue([]);
}

class StubWorkspacePort implements IWorkspacePort {
  getBaseDirectory = vi.fn().mockReturnValue('/mock/workspace');
  resolveRepositoryPath = vi.fn().mockReturnValue('/mock/workspace/my-app');
  ensureDirectory = vi.fn().mockResolvedValue(undefined);
  listProjectFolders = vi.fn().mockResolvedValue(['my-app', 'project-a', 'project-b']);
  writeFile = vi.fn().mockResolvedValue(undefined);
  ensureSymlink = vi.fn().mockResolvedValue(undefined);
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
  let portFactory: StubAgentPortFactory;
  let runtime: ConversationRuntimeService;
  let questionQueue: UserQuestionQueueService;

  beforeEach(() => {
    stubAgentPort = new StubAgentPort();
    delegateStubPort = new StubAgentPort();
    sessionStore = new InMemorySessionStoreFake();
    settingsStore = new StubAgentSettingsStore();
    agentRegistry = new StubAgentRegistryPort();
    workspacePort = new StubWorkspacePort();
    delegationDetector = new DelegationDetectorService(new QuestionParserService());

    let createCount = 0;
    portFactory = new StubAgentPortFactory(() => {
      createCount++;
      return createCount === 1 ? stubAgentPort : delegateStubPort;
    });

    wire(portFactory);
  });

  const wire = (factory: StubAgentPortFactory) => {
    runtime = new ConversationRuntimeService(factory, 60_000);
    questionQueue = new UserQuestionQueueService();
    useCase = new ExecuteAgentTurnUseCase(
      factory,
      sessionStore,
      agentRegistry,
      workspacePort,
      settingsStore,
      delegationDetector,
      runtime,
      new QuestionParserService(),
      questionQueue,
    );
  };

  const turnRequest = (overrides: Partial<TurnRequest> = {}): TurnRequest => ({
    conversationId: 'conv-1',
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
    stubAgentPort.mockResponses = ['All set.'];

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
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Implement login.</delegate>', 'Done.'];
    delegateStubPort.mockResponses = ['Login implemented.'];
    agentRegistry.getSystemPrompt.mockImplementation((role: string) => `${role} prompt`);

    const result = await useCase.execute(turnRequest({ prompt: 'Add login' }));

    expect(result.response).toBe('Done.');
    expect(workspacePort.resolveRepositoryPath).toHaveBeenCalledWith('my-app');
    expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/my-app']);
    expect(delegateStubPort.promptCalls).toEqual(['DEVELOPER prompt\n\nImplement login.']);
    expect(stubAgentPort.promptCalls).toEqual([
      'CEO prompt\n\nAdd login',
      '<agent_result role="DEVELOPER" project="my-app">\nLogin implemented.\n</agent_result>',
    ]);
    expect(delegateStubPort.closeSessionCalls).toBe(1);
    expect(delegateStubPort.connected).toBe(false);
  });

  it('should append turn reminder to CEO and delegate prompts', async () => {
    agentRegistry.getTurnReminder.mockImplementation(
      (role: string) => `${role} turn reminder`,
    );
    agentRegistry.getSystemPrompt.mockImplementation((role: string) => `${role} prompt`);
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Implement login.</delegate>', 'Done.'];
    delegateStubPort.mockResponses = ['Login implemented.'];

    const result = await useCase.execute(turnRequest({ prompt: 'Add login' }));

    expect(result.response).toBe('Done.');
    expect(stubAgentPort.promptCalls).toEqual([
      'CEO prompt\n\nAdd login\n\nCEO turn reminder',
      '<agent_result role="DEVELOPER" project="my-app">\nLogin implemented.\n</agent_result>\n\nCEO turn reminder',
    ]);
    expect(delegateStubPort.promptCalls).toEqual(['DEVELOPER prompt\n\nImplement login.\n\nDEVELOPER turn reminder']);
  });

  it('should run the delegate in the request workspace when no project is given', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER">Review it.</delegate>', 'Ok.'];
    delegateStubPort.mockResponses = ['Reviewed.'];

    await useCase.execute(turnRequest());

    expect(workspacePort.resolveRepositoryPath).not.toHaveBeenCalled();
    expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace']);
  });

  it('should notify when a delegation starts and finishes', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Ok.'];
    delegateStubPort.mockResponses = ['Done.'];
    agentRegistry.getDisplayName.mockImplementation((role: string) => `${role} name`);
    const usage = { totalTokens: 40, inputTokens: 30, outputTokens: 10 };
    delegateStubPort.usageToReturn = usage;
    const events: DelegationEvent[] = [];

    await useCase.execute(turnRequest({ onDelegation: event => events.push(event) }));

    const delegation = { round: 1, role: 'DEVELOPER', roleName: 'DEVELOPER name', projectName: 'my-app' };
    expect(events).toEqual([
      { ...delegation, phase: 'started' },
      {
        ...delegation,
        phase: 'finished',
        response: 'Done.',
        agentInfo: { roleName: 'DEVELOPER name', agentName: 'stub' },
        usage,
        durationMs: expect.any(Number),
      },
    ]);
  });

  it('should ensure each agent working directory exists before creating its session', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Ok.'];
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
    stubAgentPort.mockResponses = Array(15).fill('<delegate role="DEVELOPER" project="my-app">Delegating...</delegate>');
    delegateStubPort.mockResponses = Array(15).fill('I did it.');

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('Max delegation rounds exceeded.');
    expect(stubAgentPort.promptCalls).toHaveLength(10);
    expect(delegateStubPort.promptCalls).toHaveLength(9);
  });

  describe('delegation contract', () => {
    it('should repair a delegation missing a project folder the role requires', async () => {
      agentRegistry.getDelegationContract.mockReturnValueOnce({ project: 'required' });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER">Go.</delegate>', '<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(stubAgentPort.promptCalls[1]).toContain(
        'Role "DEVELOPER" requires a project folder. Use <delegate role="DEVELOPER" project="<project-folder>">.',
      );
    });

    it('should repair a delegation carrying a project folder the role does not take', async () => {
      agentRegistry.getDelegationContract.mockReturnValueOnce({});
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Ok, asking you first.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain(
        'Role "DEVELOPER" does not take a project folder. Use <delegate role="DEVELOPER"> without the project attribute.',
      );
      expect(delegateStubPort.promptCalls).toHaveLength(0);
    });

    it('should repair a delegation carrying a session mode the role keeps fixed', async () => {
      agentRegistry.getDelegationContract.mockReturnValueOnce({ project: 'required' });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app" session="new">Go.</delegate>', 'Ok, asking you first.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain(
        'Role "DEVELOPER" does not take a session mode. Use <delegate role="DEVELOPER"> without the session attribute.',
      );
      expect(delegateStubPort.promptCalls).toHaveLength(0);
    });
  });

  describe('delegation repair', () => {
    it('should send a repair prompt with the reason and delegate once the CEO fixes the tag', async () => {
      stubAgentPort.mockResponses = [
        '<delegate project="my-app">Cloning it.</delegate>',
        '<delegate role="DEVELOPER" project="my-app">Clone the repo.</delegate>',
        'Cloned.',
      ];
      delegateStubPort.mockResponses = ['Repo cloned.'];

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'Cloned.' });
      expect(stubAgentPort.promptCalls[1]).toContain('[DELEGATION_ERROR]');
      expect(stubAgentPort.promptCalls[1]).toContain('needs a role attribute');
      expect(delegateStubPort.promptCalls).toEqual(['Mock system prompt.\n\nClone the repo.']);
    });

    it('should repair a delegation to a role outside the team', async () => {
      stubAgentPort.mockResponses = ['<delegate role="QA" project="my-app">Test it.</delegate>', 'Ok, I will ask you first.'];

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'Ok, I will ask you first.' });
      expect(stubAgentPort.promptCalls[1]).toContain('Unknown role "QA"');
      expect(delegateStubPort.promptCalls).toHaveLength(0);
    });

    it('should repair a delegation from the CEO to itself', async () => {
      stubAgentPort.mockResponses = ['<delegate role="CEO">Plan it.</delegate>', 'Planned.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain('Unknown role "CEO"');
    });

    it('should repair a delegation to a project folder outside the workspaces root', async () => {
      workspacePort.resolveRepositoryPath.mockImplementationOnce(() => {
        throw new Error('Path is outside the workspace directory: /etc');
      });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="../../etc">Go.</delegate>', '<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(stubAgentPort.promptCalls[1]).toContain(
        'Invalid project folder "../../etc": Path is outside the workspace directory: /etc. Use one of the existing project folders exactly as written: my-app, project-a, project-b.',
      );
      expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/my-app']);
    });

    it('should repair a delegation to a project folder that does not exist, listing the existing ones', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-ap">Go.</delegate>', '<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(stubAgentPort.promptCalls[1]).toContain(
        'Project folder "my-ap" does not exist in the workspaces root. Use one of the existing project folders exactly as written: my-app, project-a, project-b.',
      );
      expect(workspacePort.ensureDirectory).not.toHaveBeenCalledWith('/mock/workspace/my-ap');
    });

    it('should ask to add the repository first when the workspace has no project folders', async () => {
      workspacePort.listProjectFolders.mockResolvedValue([]);
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Sorry.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain(
        'The workspaces root has no project folders yet; add the repository first, delegating without a project folder.',
      );
    });

    it('should stringify non-Error failures when resolving the project folder', async () => {
      workspacePort.resolveRepositoryPath.mockImplementationOnce(() => {
        throw 'bad path';
      });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="x">Go.</delegate>', 'Never mind.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain('Invalid project folder "x": bad path.');
    });

    it('should fail the turn when the repaired response is still invalid', async () => {
      stubAgentPort.mockResponses = ['Go.</delegate>', 'Still wrong.</delegate>'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('failed');
      expect(result.response).toBe('Still wrong.</delegate>');
      expect(result.errorMessage).toBe('Invalid CEO response: Found </delegate> without its opening <delegate> tag.');
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

    await useCase.execute(turnRequest({ conversationId: 'conv-th-a', prompt: 'a' }));
    await useCase.execute(turnRequest({ conversationId: 'conv-th-b', prompt: 'b' }));

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

    const first = useCase.execute(turnRequest({ conversationId: 'conv-th-1', prompt: 'one' }));
    await firstStarted;
    const second = useCase.execute(turnRequest({ conversationId: 'conv-th-1', prompt: 'two', onQueued }));
    await vi.waitFor(() => expect(onQueued).toHaveBeenCalledTimes(1));

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
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>'];
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

    await expect(runtime.cancel('conv-1')).resolves.toBe(true);
    finishConnect();
    const result = await turn;

    expect(result.status).toBe('cancelled');
    expect(delegateStubPort.promptCalls).toHaveLength(0);
    expect(delegateStubPort.createSessionCalls).toHaveLength(0);
  });

  it('should close the delegate and return cancelled when the delegate prompt is cancelled', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>'];
    delegateStubPort.promptErrorToThrow = new PromptCancelledError();

    const result = await useCase.execute(turnRequest());

    expect(result.status).toBe('cancelled');
    expect(delegateStubPort.closeSessionCalls).toBe(1);
    expect(delegateStubPort.connected).toBe(false);
  });

  it('should report a finished delegation without usage when collecting it fails', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Ok.'];
    delegateStubPort.mockResponses = ['Done.'];
    delegateStubPort.usageErrorToThrow = new Error('usage unavailable');
    const events: DelegationEvent[] = [];

    await useCase.execute(turnRequest({ onDelegation: event => events.push(event) }));

    const finished = events.find(event => event.phase === 'finished');
    expect(finished).toMatchObject({ phase: 'finished', response: 'Done.' });
    expect(finished && 'usage' in finished ? finished.usage : undefined).toBeUndefined();
  });

  it('should not report a finished delegation when the delegate is cancelled', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>'];
    delegateStubPort.promptErrorToThrow = new PromptCancelledError();
    const phases: string[] = [];

    await useCase.execute(turnRequest({ onDelegation: event => phases.push(event.phase) }));

    expect(phases).toEqual(['started']);
  });

  it('should stream text chunks and forward activities from every agent', async () => {
    stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Ok.'];
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
    expect(stubAgentPort.promptCalls[1]).toBe('<agent_result role="DEVELOPER" project="my-app">\nfirst second\n</agent_result>');
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
      sessionStore.saveSession(buildSessionContext({ agentSessions: [{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null }] }));
    const storedAgentSessions = async () => (await sessionStore.findSession('conv-1'))?.agentSessions;

    it('should persist the agent session id created for a new conversation', async () => {
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest());

      expect(await storedAgentSessions()).toEqual([{ role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null }]);
    });

    it('should resume the persisted agent session without resending the system prompt', async () => {
      await persistedSession();
      stubAgentPort.mockResponses = ['Welcome back.'];

      const result = await useCase.execute(turnRequest({ prompt: 'Continue' }));

      expect(result.sessionId).toBe('sess-1');
      expect(stubAgentPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace', sessionId: 'conv-old' }]);
      expect(stubAgentPort.createSessionCalls).toHaveLength(0);
      expect(stubAgentPort.promptCalls).toEqual(['Continue']);
      expect(await storedAgentSessions()).toEqual([{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null }]);
    });

    it('should resend the system prompt with every user message of a role that asks for it, even when resumed', async () => {
      await persistedSession();
      agentRegistry.isSystemPromptEveryTurn.mockImplementation((role: string) => role === 'CEO');
      agentRegistry.getSystemPrompt.mockImplementation((role: string) => `${role} prompt`);
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['Implemented.'];

      await useCase.execute(turnRequest({ prompt: 'Continue' }));

      expect(stubAgentPort.createSessionCalls).toHaveLength(0);
      expect(stubAgentPort.promptCalls).toEqual([
        'CEO prompt\n\nContinue',
        '<agent_result role="DEVELOPER" project="my-app">\nImplemented.\n</agent_result>',
      ]);
      expect(delegateStubPort.promptCalls).toEqual(['DEVELOPER prompt\n\nGo.']);
    });

    it('should not resend the system prompt with the repair prompt of a role that asks for it every user message', async () => {
      await persistedSession();
      agentRegistry.isSystemPromptEveryTurn.mockReturnValue(true);
      stubAgentPort.mockResponses = ['Go.</delegate>', 'Fixed.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toMatch(/^\[DELEGATION_ERROR\]/);
    });

    it('should create a new session and store its id when the load fails', async () => {
      await persistedSession();
      stubAgentPort.loadSessionResult = false;
      stubAgentPort.mockResponses = ['Fresh start.'];

      await useCase.execute(turnRequest({ prompt: 'Continue' }));

      expect(stubAgentPort.createSessionCalls).toEqual(['/mock/workspace']);
      expect(stubAgentPort.promptCalls).toEqual(['Mock system prompt.\n\nContinue']);
      expect(await storedAgentSessions()).toEqual([{ role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null }]);
    });

    it('should persist the delegate session id alongside the CEO session id', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.loadSessionCalls).toHaveLength(0);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null },
        { role: 'DEVELOPER', agentId: 'stub', sessionId: 'session-1', projectName: 'my-app' },
      ]);
    });

    it('should resume the stored delegate session without resending the system prompt', async () => {
      await sessionStore.saveSession(buildSessionContext({
        agentSessions: [{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null }, { role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-old', projectName: 'my-app' }],
      }));
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Fix it.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Fixed.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace/my-app', sessionId: 'dev-old' }]);
      expect(delegateStubPort.createSessionCalls).toHaveLength(0);
      expect(delegateStubPort.promptCalls).toEqual(['Fix it.']);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null },
        { role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-old', projectName: 'my-app' },
      ]);
    });

    it('should start a fresh delegate session when sessionMode is new in delegation marker', async () => {
      await sessionStore.saveSession(buildSessionContext({
        agentSessions: [{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null }, { role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-old', projectName: 'my-app' }],
      }));
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app" session="new">Fix it from scratch.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Fixed.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.loadSessionCalls).toHaveLength(0);
      expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/my-app']);
      expect(delegateStubPort.promptCalls).toEqual(['Mock system prompt.\n\nFix it from scratch.']);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null },
        { role: 'DEVELOPER', agentId: 'stub', sessionId: 'session-1', projectName: 'my-app' },
      ]);
    });

    it('should start a fresh delegate session when persona defaults to new session mode', async () => {
      await sessionStore.saveSession(buildSessionContext({
        agentSessions: [{ role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null }, { role: 'CODE_REVIEWER', agentId: 'stub', sessionId: 'rev-old', projectName: 'my-app' }],
      }));
      stubAgentPort.mockResponses = ['<delegate role="CODE_REVIEWER" project="my-app">Review it.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Reviewed.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.loadSessionCalls).toHaveLength(0);
      expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/my-app']);
      expect(delegateStubPort.promptCalls).toEqual(['Mock system prompt.\n\nReview it.']);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null },
        { role: 'CODE_REVIEWER', agentId: 'stub', sessionId: 'session-1', projectName: 'my-app' },
      ]);
    });

    it('should resume the delegate session created in an earlier round of the same turn', async () => {
      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" project="my-app">Build it.</delegate>',
        '<delegate role="DEVELOPER" project="my-app">Now test it.</delegate>',
        'Ok.',
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
          { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null },
          { role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-old', projectName: 'my-app' },
          { role: 'REVIEWER', agentId: 'stub', sessionId: 'rev-old', projectName: null },
        ],
      }));
      delegateStubPort.loadSessionResult = false;
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.promptCalls).toEqual(['Mock system prompt.\n\nGo.']);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null },
        { role: 'REVIEWER', agentId: 'stub', sessionId: 'rev-old', projectName: null },
        { role: 'DEVELOPER', agentId: 'stub', sessionId: 'session-1', projectName: 'my-app' },
      ]);
    });

    it('should keep the CEO agent connected when the turn fails', async () => {
      stubAgentPort.promptErrorToThrow = new Error('agent crashed');
      stubAgentPort.currentSessionId = 'session-live';

      await useCase.execute(turnRequest());

      expect(stubAgentPort.connected).toBe(true);
      expect(stubAgentPort.currentSessionId).toBe('session-live');
    });

    it('should keep the CEO agent connected when the turn is cancelled', async () => {
      stubAgentPort.promptErrorToThrow = new PromptCancelledError();

      await useCase.execute(turnRequest());

      expect(stubAgentPort.connected).toBe(true);
    });
  });

  describe('agent settings', () => {
    const settings: AgentSettings = {
      agentId: 'stub',
      agentName: 'Stub Agent',
      modelId: 'm-fast',
      modelName: 'Fast Model',
      effortId: 'high',
      effortName: 'High',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('should apply the global settings to the CEO and to delegates', async () => {
      settingsStore.settings = settings;
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Ok.'];
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
      const completed = await useCase.execute(turnRequest({ conversationId: 'conv-a' }));
      stubAgentPort.promptErrorToThrow = new PromptCancelledError();
      const cancelled = await useCase.execute(turnRequest({ conversationId: 'conv-a' }));
      stubAgentPort.promptErrorToThrow = new Error('boom');
      const failed = await useCase.execute(turnRequest({ conversationId: 'conv-a' }));

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

  describe('agent selection', () => {
    const settingsOf = (overrides: Partial<AgentSettings> = {}): AgentSettings => ({
      agentId: 'other',
      agentName: 'Other Agent',
      modelId: 'opus',
      modelName: 'Opus',
      effortId: null,
      effortName: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    });
    const storedAgentSessions = async () => (await sessionStore.findSession('conv-1'))?.agentSessions;

    it('should run the CEO and create delegates with the agent of the settings', async () => {
      settingsStore.settings = settingsOf();
      stubAgentPort.agentName = 'other';
      delegateStubPort.agentName = 'other';
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];
      const events: DelegationEvent[] = [];

      const result = await useCase.execute(turnRequest({ onDelegation: event => events.push(event) }));

      expect(portFactory.createdAgentIds).toEqual(['other', 'other']);
      expect(stubAgentPort.configCalls).toContainEqual({ modelId: 'opus', effortId: undefined });
      expect(delegateStubPort.configCalls).toEqual([{ modelId: 'opus', effortId: undefined }]);
      expect(result.agentInfo).toMatchObject({ agentName: 'other', modelName: 'Opus' });
      expect(events.find(event => event.phase === 'finished')).toMatchObject({
        agentInfo: { agentName: 'other', modelName: 'Opus' },
      });
    });

    it('should use the factory default agent when there are no settings', async () => {
      portFactory.defaultAgentId = 'fallback';
      stubAgentPort.agentName = 'fallback';
      delegateStubPort.agentName = 'fallback';
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      const result = await useCase.execute(turnRequest());

      expect(portFactory.createdAgentIds).toEqual(['fallback', 'fallback']);
      expect(result.agentInfo?.agentName).toBe('fallback');
    });

    it('should apply the role default model when the settings carry only the agent', async () => {
      settingsStore.settings = settingsOf({ agentId: 'stub', modelId: null, modelName: null });
      stubAgentPort.modelsToReturn = {
        availableModels: [{ modelId: 'current', name: 'current', displayName: 'Current Model' }],
        currentModelId: 'current',
      };
      stubAgentPort.mockResponses = ['Hi.'];

      const result = await useCase.execute(turnRequest());

      expect(stubAgentPort.configCalls).toEqual([{ modelId: 'mock-model-v1' }]);
      expect(result.agentInfo).toEqual({
        roleName: 'CEO',
        agentName: 'stub',
        modelName: 'Current Model',
        effortName: undefined,
      });
    });

    it('should ignore settings saved for a different agent than the one running', async () => {
      settingsStore.settings = settingsOf({ effortId: 'high', effortName: 'High' });
      stubAgentPort.modelsToReturn = {
        availableModels: [{ modelId: 'current', name: 'current', displayName: 'Current Model' }],
        currentModelId: 'current',
      };
      stubAgentPort.mockResponses = ['Hi.'];

      const result = await useCase.execute(turnRequest());

      expect(stubAgentPort.agentName).toBe('stub');
      expect(stubAgentPort.configCalls).toEqual([{ modelId: 'mock-model-v1' }]);
      expect(result.agentInfo).toEqual({
        roleName: 'CEO',
        agentName: 'stub',
        modelName: 'Current Model',
        effortName: undefined,
      });
    });

    it('should fail with the selected agent in the footer when the turn fails before any CEO port exists', async () => {
      settingsStore.load = async () => {
        throw new Error('settings unreadable');
      };

      const result = await useCase.execute(turnRequest());

      expect(result).toEqual({
        sessionId: undefined,
        response: '',
        status: 'failed',
        errorMessage: 'settings unreadable',
        agentInfo: { roleName: 'CEO', agentName: 'stub' },
        usage: undefined,
      });
      expect(portFactory.createdAgentIds).toHaveLength(0);
    });

    it('should persist the session ids under the agent that created them', async () => {
      settingsStore.settings = settingsOf();
      stubAgentPort.agentName = 'other';
      delegateStubPort.agentName = 'other';
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      await useCase.execute(turnRequest());

      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'other', sessionId: 'session-1', projectName: null },
        { role: 'DEVELOPER', agentId: 'other', sessionId: 'session-1', projectName: 'my-app' },
      ]);
    });

    it('should not resume a session stored for another agent and keep its entry', async () => {
      await sessionStore.saveSession(buildSessionContext({
        agentSessions: [{ role: 'CEO', agentId: 'agy', sessionId: 'agy-old', projectName: null }],
      }));
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.loadSessionCalls).toHaveLength(0);
      expect(stubAgentPort.createSessionCalls).toEqual(['/mock/workspace']);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'agy', sessionId: 'agy-old', projectName: null },
        { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null },
      ]);
    });

    it('should resume the session of the running agent among several stored agents', async () => {
      await sessionStore.saveSession(buildSessionContext({
        agentSessions: [
          { role: 'CEO', agentId: 'agy', sessionId: 'agy-old', projectName: null },
          { role: 'CEO', agentId: 'stub', sessionId: 'stub-old', projectName: null },
        ],
      }));
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.loadSessionCalls).toEqual([{ cwd: '/mock/workspace', sessionId: 'stub-old' }]);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'agy', sessionId: 'agy-old', projectName: null },
        { role: 'CEO', agentId: 'stub', sessionId: 'stub-old', projectName: null },
      ]);
    });

    it('should replace only the entry of the same role and agent when a session is rebound', async () => {
      await sessionStore.saveSession(buildSessionContext({
        agentSessions: [
          { role: 'CEO', agentId: 'agy', sessionId: 'agy-old', projectName: null },
          { role: 'CEO', agentId: 'stub', sessionId: 'stub-old', projectName: null },
        ],
      }));
      stubAgentPort.loadSessionResult = false;
      stubAgentPort.mockResponses = ['Hi.'];

      await useCase.execute(turnRequest());

      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'agy', sessionId: 'agy-old', projectName: null },
        { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null },
      ]);
    });

    it('should switch the CEO agent between turns keeping both agents sessions', async () => {
      const portsByAgent = new Map<string, StubAgentPort>();
      const switchingFactory = new StubAgentPortFactory((agentId) => {
        const port = new StubAgentPort();
        port.agentName = agentId;
        port.mockResponses = [`reply from ${agentId}`];
        portsByAgent.set(agentId, port);
        return port;
      });
      wire(switchingFactory);

      const first = await useCase.execute(turnRequest());
      settingsStore.settings = settingsOf({ modelId: null, modelName: null });
      const second = await useCase.execute(turnRequest({ prompt: 'Again' }));

      expect(first.response).toBe('reply from stub');
      expect(second.response).toBe('reply from other');
      expect(second.agentInfo?.agentName).toBe('other');
      expect(portsByAgent.get('stub')!.closeSessionCalls).toBe(1);
      expect(portsByAgent.get('stub')!.connected).toBe(false);
      expect(await storedAgentSessions()).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null },
        { role: 'CEO', agentId: 'other', sessionId: 'session-1', projectName: null },
      ]);
    });
  });

  describe('attachments extraction', () => {
    it('should extract existing attachments from completed turn response', async () => {
      vi.mocked(statSync).mockImplementation(path => ({
        isFile: () => path === '/mock/workspace/screenshot.png',
      } as any));
      stubAgentPort.mockResponses = ['Here is the screenshot:\n<attachment path="screenshot.png">Screen</attachment>'];

      const result = await useCase.execute(turnRequest({ workspacePath: '/mock/workspace' }));

      expect(result).toMatchObject({ status: 'completed', response: 'Here is the screenshot:' });
      expect(result.attachments).toEqual(['/mock/workspace/screenshot.png']);
    });

    it('should hand the text around the delegations to the channel before the agents start', async () => {
      const events: string[] = [];
      stubAgentPort.mockResponses = ['Starting now.\n<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['Implemented.'];

      await useCase.execute(turnRequest({
        onInterimMessage: message => events.push(`message: ${message}`),
        onDelegation: event => events.push(event.phase),
      }));

      expect(events).toEqual(['message: Starting now.', 'started', 'finished']);
      expect(delegateStubPort.promptCalls).toEqual(['Mock system prompt.\n\nGo.']);
    });

    it('should not send an interim message when a delegation has no text around it', async () => {
      const onInterimMessage = vi.fn();
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Done.'];
      delegateStubPort.mockResponses = ['Implemented.'];

      await useCase.execute(turnRequest({ onInterimMessage }));

      expect(onInterimMessage).not.toHaveBeenCalled();
    });

    it('should omit attachments when none exist in response', async () => {
      stubAgentPort.mockResponses = ['Plain response without images'];

      const result = await useCase.execute(turnRequest());

      expect(result.attachments).toBeUndefined();
    });
  });

  describe('incoming attachments prompt enrichment', () => {
    it('should enrich CEO prompt with [ATTACHMENTS] inventory when attachments are present', async () => {
      stubAgentPort.mockResponses = ['I have analyzed the attachments.'];

      const attachments = [
        {
          name: 'diagram.png',
          path: '/tmp/attachments/diagram.png',
          contentType: 'image/png',
          size: 1024,
        },
        {
          name: 'notes.txt',
          path: '/tmp/attachments/notes.txt',
          contentType: 'text/plain',
          size: 256,
        },
      ];

      const result = await useCase.execute(
        turnRequest({ prompt: 'Please review these files.', attachments }),
      );

      expect(result.status).toBe('completed');
      expect(stubAgentPort.promptCalls[0]).toContain('[ATTACHMENTS]');
      expect(stubAgentPort.promptCalls[0]).toContain(
        '- Name: diagram.png\n  Size: 1024 bytes\n  Type: image/png\n  Path: /tmp/attachments/diagram.png',
      );
      expect(stubAgentPort.promptCalls[0]).toContain(
        '- Name: notes.txt\n  Size: 256 bytes\n  Type: text/plain\n  Path: /tmp/attachments/notes.txt',
      );
      expect(stubAgentPort.promptCalls[0]).toContain(
        'Inspect these files using your available tools as needed.',
      );
      expect(stubAgentPort.promptCalls[0]).not.toContain('view_file');
      expect(stubAgentPort.promptCalls[0]).toContain('Please review these files.');
    });

    it('should not enrich prompt when attachments array is empty', async () => {
      stubAgentPort.mockResponses = ['No attachments.'];

      const result = await useCase.execute(
        turnRequest({ prompt: 'Hello world', attachments: [] }),
      );

      expect(result.status).toBe('completed');
      expect(stubAgentPort.promptCalls[0]).not.toContain('[ATTACHMENTS]');
      expect(stubAgentPort.promptCalls[0]).toContain('Hello world');
    });
  });

  describe('CEO steering', () => {
    const holdFirstPrompt = async () => {
      let release: () => void = () => undefined;
      let started: () => void = () => undefined;
      const firstStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      stubAgentPort.prompt = async function* (this: StubAgentPort, text: string) {
        this.promptCalls.push(text);
        if (this.promptCalls.length === 1) {
          started();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        yield textChunk(`reply to ${text}`);
      };
      return { firstStarted, release: () => release() };
    };

    it('should inject a message that arrives while the CEO is running into the running round', async () => {
      stubAgentPort.supportsSteering = true;
      const gate = await holdFirstPrompt();
      const onQueued = vi.fn();

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await gate.firstStarted;
      const second = await useCase.execute(turnRequest({ prompt: 'two', onQueued }));

      expect(second).toEqual({
        sessionId: (await sessionStore.findSession('conv-1'))?.sessionId,
        response: '',
        status: 'steered',
        agentInfo: expect.objectContaining({ roleName: 'CEO', agentName: 'stub' }),
      });
      expect(second.sessionId).toBeDefined();
      expect(stubAgentPort.steeringPrompts).toHaveLength(1);
      expect(stubAgentPort.steeringPrompts[0]).toMatch(/^\[USER_MESSAGE\]\n[\s\S]*\n\ntwo$/);
      expect(stubAgentPort.promptCalls).toHaveLength(1);
      expect(onQueued).not.toHaveBeenCalled();

      gate.release();
      const firstResult = await first;

      expect(firstResult).toMatchObject({
        status: 'completed',
        response: 'reply to Mock system prompt.\n\none',
      });
      expect(stubAgentPort.promptCalls).toHaveLength(1);
    });

    it('should steer with the attachments inventory and the turn reminder appended', async () => {
      stubAgentPort.supportsSteering = true;
      agentRegistry.getTurnReminder.mockReturnValue('CEO turn reminder');
      const gate = await holdFirstPrompt();

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await gate.firstStarted;
      const second = await useCase.execute(turnRequest({
        prompt: 'two',
        attachments: [{ name: 'notes.txt', path: '/tmp/attachments/notes.txt', contentType: 'text/plain', size: 256 }],
      }));

      expect(second.status).toBe('steered');
      expect(stubAgentPort.steeringPrompts).toHaveLength(1);
      const steeringText = stubAgentPort.steeringPrompts[0]!;
      expect(steeringText.startsWith('[USER_MESSAGE]')).toBe(true);
      expect(steeringText).toContain(
        '[ATTACHMENTS]\n- Name: notes.txt\n  Size: 256 bytes\n  Type: text/plain\n  Path: /tmp/attachments/notes.txt\n'
        + 'Inspect these files using your available tools as needed.\n\ntwo',
      );
      expect(steeringText.endsWith('two\n\nCEO turn reminder')).toBe(true);

      gate.release();
      await first;
    });

    it('should leave the session id undefined when the conversation has no stored session', async () => {
      stubAgentPort.supportsSteering = true;
      let release: () => void = () => undefined;
      const conversationKey = 'conv-1';
      const running = runtime.run(conversationKey, 'stub', () => new Promise<void>((resolve) => {
        release = resolve;
      }));
      await vi.waitFor(() => expect(runtime.getCeoPort(conversationKey)).toBe(stubAgentPort));

      const result = await useCase.execute(turnRequest({ prompt: 'two' }));

      expect(result).toMatchObject({ status: 'steered', sessionId: undefined });
      expect(stubAgentPort.steeringPrompts).toHaveLength(1);
      expect(stubAgentPort.steeringPrompts[0]).toContain('two');

      release();
      await running;
    });

    it('should queue the message and run it normally when the agent does not accept the steering', async () => {
      stubAgentPort.supportsSteering = true;
      stubAgentPort.steeringResult = false;
      const gate = await holdFirstPrompt();
      const onQueued = vi.fn();

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await gate.firstStarted;
      const second = useCase.execute(turnRequest({ prompt: 'two', onQueued }));
      await vi.waitFor(() => expect(onQueued).toHaveBeenCalledTimes(1));

      expect(stubAgentPort.steeringPrompts).toHaveLength(1);
      expect(stubAgentPort.steeringPrompts[0]).toContain('two');
      expect(stubAgentPort.promptCalls).toHaveLength(1);

      gate.release();
      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(firstResult.status).toBe('completed');
      expect(secondResult).toMatchObject({ status: 'completed', response: 'reply to two' });
    });

    it('should queue the message when the agent does not support steering', async () => {
      const gate = await holdFirstPrompt();
      const onQueued = vi.fn();

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await gate.firstStarted;
      const second = useCase.execute(turnRequest({ prompt: 'two', onQueued }));
      await vi.waitFor(() => expect(onQueued).toHaveBeenCalledTimes(1));

      expect(stubAgentPort.steeringPrompts).toEqual([]);

      gate.release();
      const [, secondResult] = await Promise.all([first, second]);

      expect(secondResult).toMatchObject({ status: 'completed', response: 'reply to two' });
    });

    it('should queue the message when the configured agent differs from the running CEO agent', async () => {
      stubAgentPort.supportsSteering = true;
      const gate = await holdFirstPrompt();
      const onQueued = vi.fn();
      delegateStubPort.agentName = 'other';
      delegateStubPort.mockResponses = ['other agent reply'];

      const first = useCase.execute(turnRequest({ prompt: 'one' }));
      await gate.firstStarted;
      settingsStore.settings = {
        agentId: 'other',
        agentName: 'Other',
        modelId: null,
        modelName: null,
        effortId: null,
        effortName: null,
        updatedAt: '2026-01-01T00:00:00Z',
      };
      const second = useCase.execute(turnRequest({ prompt: 'two', onQueued }));
      await vi.waitFor(() => expect(onQueued).toHaveBeenCalledTimes(1));

      expect(stubAgentPort.steeringPrompts).toEqual([]);

      gate.release();
      const [, secondResult] = await Promise.all([first, second]);

      expect(secondResult).toMatchObject({ status: 'completed', response: 'other agent reply' });
      expect(stubAgentPort.promptCalls).toHaveLength(1);
    });
  });

  describe('active delegations and transparent steering', () => {
    it('should prepend [ACTIVE_DELEGATIONS] block to CEO prompt when active delegations exist', async () => {
      const activeDelegatePort = new StubAgentPort();
      const conversationKey = 'conv-1';
      runtime.registerDelegation(conversationKey, {
        role: 'DEVELOPER',
        roleName: 'Developer',
        projectName: 'project-a',
        taskSpec: 'Run build and tests',
        cwd: '/mock/workspace/project-a',
        startedAt: Date.now(),
        agentPort: activeDelegatePort,
        turn: { cancel: vi.fn() } as any,
        steer: vi.fn(),
      });
      runtime.registerDelegation(conversationKey, {
        role: 'CODE_REVIEWER',
        roleName: 'Code Reviewer',
        projectName: null,
        taskSpec: 'Review code',
        cwd: '/mock/workspace',
        startedAt: Date.now(),
        agentPort: activeDelegatePort,
        turn: { cancel: vi.fn() } as any,
        steer: vi.fn(),
      });

      stubAgentPort.mockResponses = ['Understood, letting developer continue.'];
      const result = await useCase.execute(turnRequest({ prompt: 'How is it going?' }));

      expect(result.status).toBe('completed');
      expect(stubAgentPort.promptCalls[0]).toContain('[ACTIVE_DELEGATIONS]');
      expect(stubAgentPort.promptCalls[0]).toContain('- Role: DEVELOPER, Project: project-a, Task: "Run build and tests"');
      expect(stubAgentPort.promptCalls[0]).toContain('- Role: CODE_REVIEWER, Project: none, Task: "Review code"');
      expect(stubAgentPort.promptCalls[0]).toContain('How is it going?');
    });

    it('should steer active delegation when CEO delegates to an already active role with native steering', async () => {
      delegateStubPort.supportsSteering = true;
      const steerSpy = vi.fn().mockResolvedValue(true);
      const conversationKey = 'conv-1';
      runtime.registerDelegation(conversationKey, {
        role: 'DEVELOPER',
        roleName: 'Developer',
        projectName: 'project-a',
        taskSpec: 'Original task',
        cwd: '/mock/workspace/project-a',
        startedAt: Date.now(),
        agentPort: delegateStubPort,
        turn: { cancel: vi.fn() } as any,
        steer: steerSpy,
      });

      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" project="project-a">Change course.</delegate>',
        'Acknowledged.',
      ];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(steerSpy).toHaveBeenCalledWith('Change course.');
      expect(stubAgentPort.promptCalls[1]).toContain('<agent_result role="DEVELOPER" project="project-a">\nSteering message sent to active agent.\n</agent_result>');
    });

    it('should invoke sendSteeringPrompt when active delegation steer() is called and supportsSteering is true', async () => {
      delegateStubPort.supportsSteering = true;
      let steerAccepted: boolean | undefined;
      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" project="project-a">Start building.</delegate>',
        'All done.',
      ];

      const conversationKey = 'conv-1';
      let capturedDelegation: any;
      const originalPrompt = delegateStubPort.prompt.bind(delegateStubPort);
      delegateStubPort.prompt = async function* (text: string) {
        capturedDelegation = runtime.findActiveDelegation(conversationKey, 'DEVELOPER', 'project-a');
        if (capturedDelegation) {
          steerAccepted = await capturedDelegation.steer('Steered instruction');
        }
        yield* originalPrompt(text);
      };
      delegateStubPort.mockResponses = ['Build complete.'];

      const result = await useCase.execute(turnRequest());
      expect(result.status).toBe('completed');
      expect(steerAccepted).toBe(true);
      expect(delegateStubPort.steeringPrompts).toEqual(['Steered instruction']);
      expect(capturedDelegation.taskSpec).toBe('Steered instruction');
    });

    it('should report the steering as refused when the delegate agent does not accept it', async () => {
      delegateStubPort.supportsSteering = true;
      delegateStubPort.steeringResult = false;
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Ok.'];
      let steerAccepted: boolean | undefined;
      delegateStubPort.prompt = async function* () {
        const active = runtime.findActiveDelegation('conv-1', 'DEVELOPER', 'my-app');
        steerAccepted = await active?.steer('Updated task');
        yield textChunk('Done.');
      };

      await useCase.execute(turnRequest());

      expect(steerAccepted).toBe(false);
      expect(delegateStubPort.steeringPrompts).toEqual(['Updated task']);
    });

    it('should restart the delegate when its agent supports steering but does not accept the message', async () => {
      const activeDelegatePort = new StubAgentPort();
      activeDelegatePort.supportsSteering = true;
      const cancelSpy = vi.fn().mockResolvedValue(undefined);
      const steerSpy = vi.fn().mockResolvedValue(false);
      runtime.registerDelegation('conv-1', {
        role: 'DEVELOPER',
        roleName: 'Developer',
        projectName: 'my-app',
        taskSpec: 'Original task',
        cwd: '/mock/workspace/my-app',
        startedAt: Date.now(),
        agentPort: activeDelegatePort,
        turn: { cancel: cancelSpy } as any,
        steer: steerSpy,
      });
      delegateStubPort.mockResponses = ['Restarted task done.'];
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Change course.</delegate>', 'Finished.'];

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'Finished.' });
      expect(steerSpy).toHaveBeenCalledWith('Change course.');
      expect(cancelSpy).toHaveBeenCalledTimes(1);
      expect(activeDelegatePort.closeSessionCalls).toBe(1);
      expect(activeDelegatePort.connected).toBe(false);
      expect(delegateStubPort.promptCalls).toEqual([expect.stringContaining('Change course.')]);
      expect(stubAgentPort.promptCalls[1]).toBe('<agent_result role="DEVELOPER" project="my-app">\nRestarted task done.\n</agent_result>');
    });

    it('should cancel, close, unregister and recreate the delegate in the same project when supportsSteering is false', async () => {
      const firstDelegatePort = new StubAgentPort();
      firstDelegatePort.supportsSteering = false;
      const firstCancelSpy = vi.fn().mockResolvedValue(undefined);
      const firstCloseSessionSpy = vi.spyOn(firstDelegatePort, 'closeSession').mockRejectedValueOnce(new Error('close failed'));
      const firstDisconnectSpy = vi.spyOn(firstDelegatePort, 'disconnect');

      workspacePort.resolveRepositoryPath.mockImplementation((proj: string) => `/mock/workspace/${proj}`);

      const conversationKey = 'conv-1';
      runtime.registerDelegation(conversationKey, {
        role: 'DEVELOPER',
        roleName: 'Developer',
        projectName: 'project-a',
        taskSpec: 'Old task in project-a',
        cwd: '/mock/workspace/project-a',
        startedAt: Date.now() - 5000,
        agentPort: firstDelegatePort,
        turn: { cancel: firstCancelSpy } as any,
        steer: vi.fn(),
      });

      delegateStubPort.supportsSteering = false;
      delegateStubPort.mockResponses = ['Completed the new task in project-a.'];

      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" project="project-a">New task in project-a.</delegate>',
        'All finished.',
      ];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(result.response).toBe('All finished.');
      expect(firstCancelSpy).toHaveBeenCalled();
      expect(firstCloseSessionSpy).toHaveBeenCalled();
      expect(firstDisconnectSpy).toHaveBeenCalled();
      expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/project-a']);
      expect(delegateStubPort.promptCalls[0]).toContain('New task in project-a.');
      expect(stubAgentPort.promptCalls[1]).toContain('<agent_result role="DEVELOPER" project="project-a">\nCompleted the new task in project-a.\n</agent_result>');
      expect(stubAgentPort.promptCalls[1]).not.toContain('Steering message sent to active agent.');
    });

    it('should not remove a newer active delegation when a previous delegation completes its finally block', async () => {
      const conversationKey = 'conv-1';
      const newerDelegatePort = new StubAgentPort();
      const newerDelegation = {
        role: 'DEVELOPER',
        roleName: 'Developer',
        projectName: 'project-a',
        taskSpec: 'Concurrent newer task',
        cwd: '/mock/workspace/project-a',
        startedAt: Date.now(),
        agentPort: newerDelegatePort,
        turn: { cancel: vi.fn() } as any,
        steer: vi.fn(),
      };

      const unregisterSpy = vi.spyOn(runtime, 'unregisterDelegation');

      delegateStubPort.prompt = async function* () {
        runtime.registerDelegation(conversationKey, newerDelegation);
        yield textChunk('Original delegation finished');
      };

      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" project="project-a">Run initial task.</delegate>',
        'Done.',
      ];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(unregisterSpy).toHaveBeenCalledWith(
        conversationKey,
        expect.objectContaining({
          role: 'DEVELOPER',
          taskSpec: 'Run initial task.',
        }),
      );
      expect(runtime.findActiveDelegation(conversationKey, 'DEVELOPER', 'project-a')).toBe(newerDelegation);
    });
  });

  describe('parallel delegations', () => {
    let delegatePorts: StubAgentPort[];

    const delegatePort = (response: string) => {
      const port = new StubAgentPort();
      port.mockResponses = [response];
      return port;
    };

    const readOnlyRoles = (...roles: string[]) => {
      agentRegistry.getDelegationContract.mockImplementation((role: string) => ({
        project: 'optional',
        sessionMode: 'overridable',
        ...(roles.includes(role) ? { readOnly: true } : {}),
      }) as DelegationContract);
    };

    const activeDelegation = (role: string, projectName: string) => ({
      role,
      roleName: role,
      projectName,
      taskSpec: 'Running task',
      cwd: `/mock/workspace/${projectName}`,
      startedAt: Date.now(),
      agentPort: new StubAgentPort(),
      turn: { cancel: vi.fn() } as any,
      steer: vi.fn().mockResolvedValue(false),
    });

    beforeEach(() => {
      delegatePorts = [];
      workspacePort.resolveRepositoryPath.mockImplementation((project: string) => `/mock/workspace/${project}`);
      let created = 0;
      portFactory = new StubAgentPortFactory(() => (created++ === 0 ? stubAgentPort : delegatePorts.shift()!));
      wire(portFactory);
    });

    it('should run every delegation of one response at the same time and return all results in order', async () => {
      const started: string[] = [];
      let releaseAll!: () => void;
      const allStarted = new Promise<void>((resolve) => {
        releaseAll = resolve;
      });
      const gated = (name: string, response: string) => {
        const port = delegatePort(response);
        const original = port.prompt.bind(port);
        port.prompt = async function* (text: string) {
          started.push(name);
          if (started.length === 2) {
            releaseAll();
          }
          await allStarted;
          yield* original(text);
        };
        return port;
      };
      delegatePorts = [gated('backend', 'API ready.'), gated('frontend', 'Screen ready.')];
      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" project="project-a">Build the API.</delegate>\n<delegate role="DEVELOPER" project="project-b">Build the screen.</delegate>',
        'Both done.',
      ];

      const result = await useCase.execute(turnRequest());

      expect(result.response).toBe('Both done.');
      expect(started).toEqual(['backend', 'frontend']);
      expect(stubAgentPort.promptCalls[1]).toBe(
        '<agent_result role="DEVELOPER" project="project-a">\nAPI ready.\n</agent_result>\n\n<agent_result role="DEVELOPER" project="project-b">\nScreen ready.\n</agent_result>',
      );
      expect(runtime.getActiveDelegations('conv-1')).toEqual([]);
    });

    it('should let a read-only agent work alongside an agent that modifies the same project', async () => {
      readOnlyRoles('CODE_REVIEWER');
      delegatePorts = [delegatePort('Implemented.'), delegatePort('Reviewed.')];
      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" project="my-app">Implement.</delegate>\n<delegate role="CODE_REVIEWER" project="my-app">Review main.</delegate>',
        'Ok.',
      ];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(stubAgentPort.promptCalls[1]).toContain('<agent_result role="CODE_REVIEWER" project="my-app">\nReviewed.\n</agent_result>');
    });

    it('should reject two agents that modify the same project in one response', async () => {
      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" project="my-app">Implement.</delegate>\n<delegate role="CODE_REVIEWER" project="my-app">Push.</delegate>',
        'Sorry.',
      ];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain(
        'CODE_REVIEWER cannot work in project folder "my-app" at the same time as DEVELOPER',
      );
      expect(portFactory.createdAgentIds).toEqual(['stub']);
    });

    it('should reject the same role twice for the same project', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">A.</delegate>\n<delegate role="DEVELOPER" project="my-app">B.</delegate>', 'Sorry.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain(
        'DEVELOPER appears more than once for project folder "my-app". Merge those tasks into a single delegation.',
      );
    });

    it('should reject the same role twice at the workspaces root', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER">A.</delegate>\n<delegate role="DEVELOPER">B.</delegate>', 'Sorry.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain('DEVELOPER appears more than once for the workspaces root.');
    });

    it('should reject an agent that modifies a project another agent is already modifying', async () => {
      runtime.registerDelegation('conv-1', activeDelegation('GIT_OPS', 'my-app'));
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Implement.</delegate>', 'Sorry.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain(
        'DEVELOPER cannot work in project folder "my-app" at the same time as GIT_OPS, which is already working there',
      );
    });

    it('should ignore running read-only agents and agents in other projects when checking conflicts', async () => {
      readOnlyRoles('TECH_LEAD');
      runtime.registerDelegation('conv-1', activeDelegation('TECH_LEAD', 'my-app'));
      runtime.registerDelegation('conv-1', activeDelegation('DEVELOPER', 'project-a'));
      delegatePorts = [delegatePort('Implemented.')];
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Implement.</delegate>', 'Ok.'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(runtime.getActiveDelegations('conv-1').map(delegation => delegation.projectName)).toEqual(['my-app', 'project-a']);
    });

    it('should keep the sessions of one role apart per project', async () => {
      await sessionStore.saveSession(buildSessionContext({
        agentSessions: [
          { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null },
          { role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-a', projectName: 'project-a' },
        ],
      }));
      delegatePorts = [delegatePort('Done in b.')];
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="project-b">Work on b.</delegate>', 'Ok.'];

      await useCase.execute(turnRequest());

      expect((await sessionStore.findSession('conv-1'))?.agentSessions).toEqual([
        { role: 'CEO', agentId: 'stub', sessionId: 'conv-old', projectName: null },
        { role: 'DEVELOPER', agentId: 'stub', sessionId: 'dev-a', projectName: 'project-a' },
        { role: 'DEVELOPER', agentId: 'stub', sessionId: 'session-1', projectName: 'project-b' },
      ]);
    });

    it('should keep the sessions bound by every parallel delegation', async () => {
      delegatePorts = [delegatePort('Done in a.'), delegatePort('Done in b.')];
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="project-a">A.</delegate>\n<delegate role="DEVELOPER" project="project-b">B.</delegate>', 'Ok.'];

      await useCase.execute(turnRequest());

      const developerSessions = (await sessionStore.findSession('conv-1'))?.agentSessions
        .filter(agentSession => agentSession.role === 'DEVELOPER')
        .map(agentSession => agentSession.projectName);
      expect(developerSessions).toEqual(['project-a', 'project-b']);
    });

    it('should keep binding sessions after one binding fails to save', async () => {
      const save = sessionStore.saveSession.bind(sessionStore);
      sessionStore.saveSession = async (session) => {
        if (session.agentSessions.at(-1)?.projectName === 'project-a') {
          throw new Error('EACCES: permission denied');
        }
        await save(session);
      };
      delegatePorts = [delegatePort('Done in a.'), delegatePort('Done in b.')];
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="project-a">A.</delegate>\n<delegate role="DEVELOPER" project="project-b">B.</delegate>', 'Ok.'];

      await useCase.execute(turnRequest());

      expect((await sessionStore.findSession('conv-1'))?.agentSessions.at(-1)?.projectName).toBe('project-b');
    });

    it('should wait for every delegation and hand the failure to the CEO along with the other results', async () => {
      const failing = delegatePort('');
      failing.promptErrorToThrow = new Error('agent crashed');
      const healthy = delegatePort('Done.');
      delegatePorts = [failing, healthy];
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="project-a">A.</delegate>\n<delegate role="DEVELOPER" project="project-b">B.</delegate>', 'Retrying a.'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      expect(stubAgentPort.promptCalls[1]).toBe(
        '<agent_result role="DEVELOPER" project="project-a" status="failed">\nagent crashed\n</agent_result>\n\n<agent_result role="DEVELOPER" project="project-b">\nDone.\n</agent_result>',
      );
      expect(healthy.closeSessionCalls).toBe(1);
    });

    it('should hand a failure that is not an Error to the CEO as text', async () => {
      const failing = delegatePort('');
      failing.connect = async () => {
        throw 'transport closed';
      };
      delegatePorts = [failing];
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="project-a">A.</delegate>', 'Ok.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toBe('<agent_result role="DEVELOPER" project="project-a" status="failed">\ntransport closed\n</agent_result>');
    });

    it('should report the turn as cancelled when any parallel delegation was cancelled', async () => {
      const failing = delegatePort('');
      failing.promptErrorToThrow = new Error('agent crashed');
      const cancelled = delegatePort('');
      cancelled.promptErrorToThrow = new PromptCancelledError();
      delegatePorts = [failing, cancelled];
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="project-a">A.</delegate>\n<delegate role="DEVELOPER" project="project-b">B.</delegate>'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('cancelled');
    });
  });

  describe('edge cases', () => {
    it('should return cancelled with an empty response when cancelled before any CEO port exists', async () => {
      settingsStore.load = async () => {
        throw new PromptCancelledError();
      };

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({
        status: 'cancelled',
        response: '',
        agentInfo: { roleName: 'CEO', agentName: 'stub' },
      });
      expect(portFactory.createdAgentIds).toHaveLength(0);
    });

    it('should omit the project in the repair hint when a session mode is sent without a project', async () => {
      agentRegistry.getDelegationContract.mockReturnValueOnce({});
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" session="new">Go.</delegate>', 'Ok, asking you first.'];

      await useCase.execute(turnRequest());

      expect(stubAgentPort.promptCalls[1]).toContain(
        'Role "DEVELOPER" does not take a session mode. Use <delegate role="DEVELOPER"> without the session attribute.',
      );
    });

    it('should log a shortened preview of long delegation tasks without altering the task', async () => {
      const longTask = `Implement ${'a very long feature '.repeat(10)}`.trim();
      stubAgentPort.mockResponses = [`<delegate role="DEVELOPER" project="my-app">${longTask}</delegate>`, 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.promptCalls).toEqual([`Mock system prompt.\n\n${longTask}`]);
    });

    it('should bind the agent session using the in-memory session when the store no longer holds it', async () => {
      const findSession = sessionStore.findSession.bind(sessionStore);
      let lookups = 0;
      sessionStore.findSession = async (conversationId) => {
        lookups++;
        return lookups === 1 ? findSession(conversationId) : null;
      };
      stubAgentPort.mockResponses = ['Hi.'];

      const result = await useCase.execute(turnRequest());

      expect(result.status).toBe('completed');
      const saved = await findSession('conv-1');
      expect(saved?.agentSessions).toEqual([{ role: 'CEO', agentId: 'stub', sessionId: 'session-1', projectName: null }]);
    });

    it('should ignore failures while closing the delegate after it finishes', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];
      delegateStubPort.closeSession = async () => {
        throw new Error('close failed');
      };
      delegateStubPort.disconnect = async () => {
        throw new Error('disconnect failed');
      };

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'Ok.' });
    });

    it('should ignore failures while disposing a delegate that cannot be steered', async () => {
      const staleDelegatePort = new StubAgentPort();
      staleDelegatePort.closeSession = async () => {
        throw new Error('close failed');
      };
      staleDelegatePort.disconnect = async () => {
        throw new Error('disconnect failed');
      };
      runtime.registerDelegation('conv-1', {
        role: 'DEVELOPER',
        roleName: 'Developer',
        projectName: null,
        taskSpec: 'Old task',
        cwd: '/mock/workspace',
        startedAt: Date.now(),
        agentPort: staleDelegatePort,
        turn: { cancel: vi.fn().mockResolvedValue(undefined) } as any,
        steer: vi.fn(),
      });
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      const result = await useCase.execute(turnRequest());

      expect(result).toMatchObject({ status: 'completed', response: 'Ok.' });
      expect(delegateStubPort.promptCalls).toHaveLength(1);
    });

    it('should record the new task without steering a delegate whose agent lacks steering', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Go.</delegate>', 'Ok.'];
      let captured: { taskSpec: string } | undefined;
      let steerAccepted: boolean | undefined;
      delegateStubPort.prompt = async function* () {
        const active = runtime.findActiveDelegation('conv-1', 'DEVELOPER', 'my-app');
        steerAccepted = await active?.steer('Updated task');
        captured = active;
        yield textChunk('Done.');
      };

      await useCase.execute(turnRequest());

      expect(captured?.taskSpec).toBe('Updated task');
      expect(steerAccepted).toBe(false);
      expect(delegateStubPort.steeringPrompts).toHaveLength(0);
    });
  });

  describe('questions to the user', () => {
    const answerWith = (...inputs: string[]) => (): void => {
      queueMicrotask(() => {
        while (inputs.length > 0 && questionQueue.hasPending('conv-1')) {
          questionQueue.submit('conv-1', { text: inputs.shift()! });
        }
      });
    };

    it('should hand the user answers to the asking delegate and deliver only its final result to the CEO', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">Discover it.</delegate>', 'Here is the document.'];
      delegateStubPort.mockResponses = [
        'I understood X.\n<question rationale="Defines the flow.">Who approves?<option>Manager</option><option>Finance</option></question>\n<question>What is the "limit"?</question>',
        'Document at /tmp/intent.md',
      ];
      const prompts: QuestionPrompt[] = [];
      const answer = answerWith('2', 'R$ 500');

      const result = await useCase.execute(turnRequest({
        onQuestion: (prompt) => {
          prompts.push(prompt);
          answer();
        },
      }));

      expect(result).toMatchObject({ status: 'completed', response: 'Here is the document.' });
      expect(prompts).toEqual([
        {
          asker: { role: 'DEVELOPER', roleName: 'DEVELOPER', projectName: 'my-app' },
          question: { text: 'Who approves?', rationale: 'Defines the flow.', options: ['Manager', 'Finance'] },
          number: 1,
          total: 2,
          message: 'I understood X.',
          waitingAskers: 0,
        },
      ]);
      expect(delegateStubPort.promptCalls[1]).toBe([
        '<user_answers>',
        '<answer question="Who approves?" option="2">Finance</answer>',
        '<answer question="What is the &quot;limit&quot;?" kind="other">R$ 500</answer>',
        '</user_answers>',
      ].join('\n'));
      expect(stubAgentPort.promptCalls).toHaveLength(2);
      expect(stubAgentPort.promptCalls[1]).toBe('<agent_result role="DEVELOPER" project="my-app">\nDocument at /tmp/intent.md\n</agent_result>');
    });

    it('should give the agent the path of each file attached to an answer', async () => {
      stubAgentPort.mockResponses = ['<question>Show me the current screen.</question>', 'Thanks.'];
      const file = { name: 'screen.png', path: '/tmp/attachments/screen.png', contentType: 'image/png', size: 10 };

      await useCase.execute(turnRequest({
        onQuestion: () => queueMicrotask(() => questionQueue.submit('conv-1', { text: 'Here', attachments: [file] })),
      }));

      expect(stubAgentPort.promptCalls[1]).toBe([
        '<user_answers>',
        '<answer question="Show me the current screen." kind="other">Here',
        '<attachment path="/tmp/attachments/screen.png" name="screen.png" type="image/png"/></answer>',
        '</user_answers>',
      ].join('\n'));
    });

    it('should hand the user answers to the CEO with its system prompt and finish with its next answer', async () => {
      agentRegistry.isSystemPromptEveryTurn.mockReturnValue(true);
      stubAgentPort.mockResponses = ['Before I start:\n<question>Which project?<option>Backend</option></question>', 'Starting on the backend.'];

      const result = await useCase.execute(turnRequest({ onQuestion: answerWith('1') }));

      expect(result).toMatchObject({ status: 'completed', response: 'Starting on the backend.' });
      expect(stubAgentPort.promptCalls[1]).toBe(
        'Mock system prompt.\n\n<user_answers>\n<answer question="Which project?" option="1">Backend</answer>\n</user_answers>',
      );
    });

    it('should ask the user in the order the parallel delegates asked', async () => {
      const ports = [new StubAgentPort(), new StubAgentPort()];
      let releaseSecond!: () => void;
      const secondMayAsk = new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
      ports[0]!.mockResponses = ['<question>First?</question>', 'First done.'];
      ports[1]!.mockResponses = ['<question>Second?</question>', 'Second done.'];
      const original = ports[1]!.prompt.bind(ports[1]);
      ports[1]!.prompt = async function* (text: string) {
        await secondMayAsk;
        yield* original(text);
      };
      let created = 0;
      workspacePort.resolveRepositoryPath.mockImplementation((project: string) => `/mock/workspace/${project}`);
      wire(new StubAgentPortFactory(() => (created++ === 0 ? stubAgentPort : ports.shift()!)));
      agentRegistry.getDelegationContract.mockReturnValue({ project: 'optional', sessionMode: 'overridable', readOnly: true });
      stubAgentPort.mockResponses = [
        '<delegate role="DEVELOPER" project="project-a">A.</delegate>\n<delegate role="CODE_REVIEWER" project="project-b">B.</delegate>',
        'Both done.',
      ];
      const shown: string[] = [];
      const answers = answerWith('one', 'two');

      const result = await useCase.execute(turnRequest({
        onQuestion: (prompt) => {
          shown.push(`${prompt.question.text} (${prompt.waitingAskers} waiting)`);
          if (shown.length === 1) {
            releaseSecond();
            setTimeout(answers, 0);
          }
        },
      }));

      expect(result.response).toBe('Both done.');
      expect(shown).toEqual(['First? (0 waiting)']);
      expect(stubAgentPort.promptCalls[1]).toBe([
        '<agent_result role="DEVELOPER" project="project-a">\nFirst done.\n</agent_result>',
        '<agent_result role="CODE_REVIEWER" project="project-b">\nSecond done.\n</agent_result>',
      ].join('\n\n'));
    });

    it('should repair a CEO response with malformed questions', async () => {
      stubAgentPort.mockResponses = ['<question>Which?', 'Fixed.'];

      const result = await useCase.execute(turnRequest());

      expect(result.response).toBe('Fixed.');
      expect(stubAgentPort.promptCalls[1]).toContain('must be closed with </question>');
    });

    it('should ask the delegate to fix malformed questions once and then take its response as the result', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['<option>A</option>', 'Still <option>B</option>'];

      await useCase.execute(turnRequest());

      expect(delegateStubPort.promptCalls[1]).toContain('[QUESTION_ERROR]');
      expect(stubAgentPort.promptCalls[1]).toBe('<agent_result role="DEVELOPER">\nStill <option>B</option>\n</agent_result>');
    });

    it('should ask the user again after the delegate fixes its questions', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER">Go.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['<question>Q?', '<question>Q?</question>', 'Done.'];

      await useCase.execute(turnRequest({ onQuestion: answerWith('yes') }));

      expect(delegateStubPort.promptCalls[2]).toContain('kind="other">yes</answer>');
      expect(stubAgentPort.promptCalls[1]).toBe('<agent_result role="DEVELOPER">\nDone.\n</agent_result>');
    });

    it('should end the turn as cancelled when the questions are cancelled while the delegate waits', async () => {
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER">Go.</delegate>'];
      delegateStubPort.mockResponses = ['<question>Q?</question>'];

      const result = await useCase.execute(turnRequest({
        onQuestion: () => queueMicrotask(() => questionQueue.cancel('conv-1')),
      }));

      expect(result.status).toBe('cancelled');
      expect(questionQueue.hasPending('conv-1')).toBe(false);
    });

    it('should replace a delegate waiting for answers instead of steering it', async () => {
      const waitingPort = new StubAgentPort();
      waitingPort.supportsSteering = true;
      const steer = vi.fn().mockResolvedValue(true);
      const cancel = vi.fn().mockResolvedValue(undefined);
      runtime.registerDelegation('conv-1', {
        role: 'DEVELOPER',
        roleName: 'Developer',
        projectName: 'my-app',
        taskSpec: 'Old task',
        cwd: '/mock/workspace/my-app',
        startedAt: Date.now(),
        agentPort: waitingPort,
        turn: { cancel } as any,
        steer,
      });
      const waiting = questionQueue.ask('conv-1', { role: 'DEVELOPER', roleName: 'Developer', projectName: 'my-app' }, '', [{ text: 'Q?', options: [] }]);
      stubAgentPort.mockResponses = ['<delegate role="DEVELOPER" project="my-app">New task.</delegate>', 'Ok.'];
      delegateStubPort.mockResponses = ['Done.'];

      const result = await useCase.execute(turnRequest());

      expect(result.response).toBe('Ok.');
      expect(steer).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalled();
      await expect(waiting).rejects.toBeInstanceOf(PromptCancelledError);
    });
  });
});
