import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import { type AgentUpdate, PromptCancelledError } from '../../agent/ports/agent.port.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import { InMemorySessionStoreAdapter } from '../adapters/in-memory-session-store.adapter.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { ConversationRuntimeService } from '../services/conversation-runtime.service.js';
import { DelegationDetectorService } from '../services/delegation-detector.service.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';

import { ExecuteAgentTurnUseCase } from './execute-agent-turn.use-case.js';


class StubAgentRegistryPort implements IAgentRegistryPort {
  getDefaultModel = vi.fn().mockReturnValue('mock-model-v1');
  getSystemPrompt = vi.fn().mockReturnValue('Mock system prompt.');
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
  return {
    sessionId: 's',
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  };
}

describe('ExecuteAgentTurnUseCase', () => {
  let useCase: ExecuteAgentTurnUseCase;
  let stubAgentPort: StubAgentPort;
  let delegateStubPort: StubAgentPort;
  let sessionStore: InMemorySessionStoreAdapter;
  let agentRegistry: StubAgentRegistryPort;
  let workspacePort: StubWorkspacePort;
  let delegationDetector: DelegationDetectorService;
  let runtime: ConversationRuntimeService;

  beforeEach(() => {
    stubAgentPort = new StubAgentPort();
    delegateStubPort = new StubAgentPort();
    sessionStore = new InMemorySessionStoreAdapter();
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

    runtime = new ConversationRuntimeService(portFactory, sessionStore, 60_000);
    useCase = new ExecuteAgentTurnUseCase(
      portFactory,
      sessionStore,
      agentRegistry,
      workspacePort,
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
    });
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
    const sessionId = (await sessionStore.findSession('ch-1'))!.sessionId;

    await expect(runtime.cancel(sessionId)).resolves.toBe(true);
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

  it('should stream text chunks and forward activities from every agent', async () => {
    stubAgentPort.mockResponses = ['Go.\n[DELEGATE:DEVELOPER:my-app]', 'Ok.\n[DONE]'];
    delegateStubPort.prompt = async function* (this: StubAgentPort) {
      this.emitActivity({ kind: 'thought', id: 't', text: 'thinking' });
      yield textChunk('first ');
      yield { sessionId: 's', update: { sessionUpdate: 'tool_call', toolCallId: 't', title: 'ls' } };
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
});
