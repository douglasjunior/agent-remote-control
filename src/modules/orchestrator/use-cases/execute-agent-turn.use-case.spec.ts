import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IAgentPortFactory } from '../../agent/ports/agent-port-factory.port.js';
import { type AgentUpdate, PromptCancelledError } from '../../agent/ports/agent.port.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import { InMemorySessionStoreAdapter } from '../adapters/in-memory-session-store.adapter.js';
import { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { DelegationDetectorService } from '../services/delegation-detector.service.js';
import { buildSessionContext } from '../testing/session-context.fixture.js';
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

    useCase = new ExecuteAgentTurnUseCase(
      portFactory,
      sessionStore,
      agentRegistry,
      workspacePort,
      delegationDetector,
    );
  });

  it('should return direct_response on first turn without delegation', async () => {
    stubAgentPort.mockResponses = ['Hello world!'];

    const request = {
      channelId: 'ch-1',
      userId: 'user-1',
      prompt: 'Say hello',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
    };

    const result = await useCase.execute(request);

    expect(result.status).toBe('completed');
    expect(result.response).toBe('Hello world!');
    expect(stubAgentPort.connectCalls).toBe(1);
    expect(stubAgentPort.createSessionCalls.length).toBe(1);
  });

  it('should handle done marker correctly', async () => {
    stubAgentPort.mockResponses = ['Task is finished\n[DONE]'];

    const request = {
      channelId: 'ch-1',
      userId: 'user-1',
      prompt: 'Do task',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
    };

    const result = await useCase.execute(request);

    expect(result.status).toBe('completed');
    expect(result.response).toBe('Task is finished');
  });

  it('should handle one delegation round', async () => {
    stubAgentPort.mockResponses = [
      'Delegating...\n[DELEGATE:DEVELOPER:my-app]',
      'All good.\n[DONE]',
    ];
    delegateStubPort.mockResponses = ['I wrote the code.'];

    const request = {
      channelId: 'ch-1',
      userId: 'user-1',
      prompt: 'Write code',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
    };

    const result = await useCase.execute(request);

    expect(result.status).toBe('completed');
    expect(result.response).toBe('All good.');
    expect(stubAgentPort.connectCalls).toBe(2);
    expect(delegateStubPort.connectCalls).toBe(1);
    expect(delegateStubPort.closeSessionCalls).toBe(1);
  });

  it('should return failed when max delegation rounds exceeded', async () => {
    stubAgentPort.mockResponses = Array(15).fill('Delegating...\n[DELEGATE:DEVELOPER:my-app]');
    delegateStubPort.mockResponses = Array(15).fill('I did it.');

    const request = {
      channelId: 'ch-1',
      userId: 'user-1',
      prompt: 'Looping task',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
    };

    const result = await useCase.execute(request);

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('Max delegation rounds exceeded.');
    expect(stubAgentPort.connectCalls).toBe(10);
  });

  it('should return cancelled when PromptCancelledError is thrown', async () => {
    stubAgentPort.promptErrorToThrow = new PromptCancelledError();

    const request = {
      channelId: 'ch-1',
      userId: 'user-1',
      prompt: 'Cancel me',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
    };

    const result = await useCase.execute(request);

    expect(result.status).toBe('cancelled');
  });

  it('should return failed when generic error is thrown', async () => {
    stubAgentPort.promptErrorToThrow = new Error('Generic error');

    const request = {
      channelId: 'ch-1',
      userId: 'user-1',
      prompt: 'Error me',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
    };

    const result = await useCase.execute(request);

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('Generic error');
  });

  it('should run the delegate in the resolved project directory with its own system prompt', async () => {
    stubAgentPort.mockResponses = [
      'Implement login.\n[DELEGATE:DEVELOPER:my-app]',
      'Done.\n[DONE]',
    ];
    delegateStubPort.mockResponses = ['Login implemented.'];
    agentRegistry.getSystemPrompt.mockImplementation((role: string) => `${role} prompt`);

    await useCase.execute({
      channelId: 'ch-1',
      userId: 'user-1',
      prompt: 'Add login',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
    });

    expect(workspacePort.resolveRepositoryPath).toHaveBeenCalledWith('my-app');
    expect(stubAgentPort.createSessionCalls).toEqual(['/mock/workspace']);
    expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace/my-app']);
    expect(delegateStubPort.promptCalls).toEqual(['DEVELOPER prompt\n\nImplement login.']);
    expect(stubAgentPort.promptCalls[1]).toBe('[AGENT_RESULT:DEVELOPER]\nLogin implemented.');
  });

  it('should ensure each agent working directory exists before creating its session', async () => {
    stubAgentPort.mockResponses = ['Go.\n[DELEGATE:DEVELOPER:my-app]', 'Ok.\n[DONE]'];
    delegateStubPort.mockResponses = ['Done.'];

    await useCase.execute({
      channelId: 'ch-1',
      userId: 'user-1',
      prompt: 'Work',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
    });

    expect(workspacePort.ensureDirectory.mock.calls).toEqual([
      ['/mock/workspace'],
      ['/mock/workspace/my-app'],
    ]);
  });

  it('should fail the turn without creating a session when the directory cannot be prepared', async () => {
    workspacePort.ensureDirectory.mockRejectedValue(new Error('Path is outside the workspace directory: /x'));

    const result = await useCase.execute({
      channelId: 'ch-1',
      userId: 'user-1',
      prompt: 'Hi',
      workspacePath: '/x',
      agentRole: 'CEO',
    });

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('Path is outside the workspace directory: /x');
    expect(stubAgentPort.createSessionCalls).toHaveLength(0);
  });

  it('should run the delegate in the request workspace when no project is given', async () => {
    stubAgentPort.mockResponses = ['Review it.\n[DELEGATE:DEVELOPER]', 'Ok.\n[DONE]'];
    delegateStubPort.mockResponses = ['Reviewed.'];

    await useCase.execute({
      channelId: 'ch-1',
      userId: 'user-1',
      prompt: 'Review',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
    });

    expect(workspacePort.resolveRepositoryPath).not.toHaveBeenCalled();
    expect(delegateStubPort.createSessionCalls).toEqual(['/mock/workspace']);
  });

  it('should expose the delegate port as active only while the delegate runs', async () => {
    stubAgentPort.mockResponses = ['Go.\n[DELEGATE:DEVELOPER:my-app]', 'Ok.\n[DONE]'];
    let activePortDuringDelegation: unknown;
    delegateStubPort.prompt = async function* () {
      const session = await sessionStore.findSession('ch-1', 'th-1');
      activePortDuringDelegation = session?.activeAgentPort;
      yield textChunk('Worked.');
    };

    await useCase.execute({
      channelId: 'ch-1',
      threadId: 'th-1',
      userId: 'user-1',
      prompt: 'Work',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
    });

    const session = await sessionStore.findSession('ch-1', 'th-1');
    expect(activePortDuringDelegation).toBe(delegateStubPort);
    expect(session?.activeAgentPort).toBe(stubAgentPort);
    expect(session?.agentPort).toBe(stubAgentPort);
  });

  it('should close the delegate and return cancelled when the delegate is cancelled', async () => {
    stubAgentPort.mockResponses = ['Go.\n[DELEGATE:DEVELOPER:my-app]'];
    delegateStubPort.promptErrorToThrow = new PromptCancelledError();

    const result = await useCase.execute({
      channelId: 'ch-1',
      userId: 'user-1',
      prompt: 'Work',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
    });

    const session = await sessionStore.findSession('ch-1');
    expect(result.status).toBe('cancelled');
    expect(delegateStubPort.closeSessionCalls).toBe(1);
    expect(delegateStubPort.connected).toBe(false);
    expect(session?.activeAgentPort).toBe(stubAgentPort);
  });

  it('should reuse the session agent port and skip the system prompt on later turns', async () => {
    stubAgentPort.mockResponses = ['First.', 'Second.'];
    const request = {
      channelId: 'ch-1',
      userId: 'user-1',
      prompt: 'Hi',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
    };

    await useCase.execute(request);
    await useCase.execute({ ...request, prompt: 'Again' });

    expect(stubAgentPort.createSessionCalls.length).toBe(1);
    expect(stubAgentPort.promptCalls).toEqual(['Mock system prompt.\n\nHi', 'Again']);
  });

  it('should isolate agent ports between different threads', async () => {
    stubAgentPort.mockResponses = ['A.'];
    delegateStubPort.mockResponses = ['B.'];
    const request = {
      channelId: 'ch-1',
      userId: 'user-1',
      prompt: 'Hi',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
    };

    await useCase.execute({ ...request, threadId: 'th-a' });
    await useCase.execute({ ...request, threadId: 'th-b' });

    expect((await sessionStore.findSession('ch-1', 'th-a'))?.agentPort).toBe(stubAgentPort);
    expect((await sessionStore.findSession('ch-1', 'th-b'))?.agentPort).toBe(delegateStubPort);
  });

  it('should restore the session agent port as active when a stored session is resumed', async () => {
    const stalePort = new StubAgentPort();
    await sessionStore.saveSession(
      buildSessionContext({
        sessionId: 'sess-existing',
        agentPort: stubAgentPort,
        activeAgentPort: stalePort,
      }),
    );
    stubAgentPort.mockResponses = ['Hi.'];

    const result = await useCase.execute({
      channelId: 'ch-1',
      userId: 'user-1',
      prompt: 'Hi',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
    });

    expect(result.sessionId).toBe('sess-existing');
    expect((await sessionStore.findSession('ch-1'))?.activeAgentPort).toBe(stubAgentPort);
    expect(stubAgentPort.promptCalls).toEqual(['Hi']);
  });

  it('should stream text chunks and forward activities from every agent', async () => {
    stubAgentPort.mockResponses = ['Go.\n[DELEGATE:DEVELOPER:my-app]', 'Ok.\n[DONE]'];
    delegateStubPort.prompt = async function* (this: StubAgentPort) {
      this.emitActivity({ kind: 'thought', text: 'thinking' } as never);
      yield textChunk('first ');
      yield { sessionId: 's', update: { sessionUpdate: 'tool_call', toolCallId: 't', title: 'ls' } };
      yield textChunk('second');
    };
    const onActivity = vi.fn();
    const onTextChunk = vi.fn();

    await useCase.execute({
      channelId: 'ch-1',
      userId: 'user-1',
      prompt: 'Work',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
      onActivity,
      onTextChunk,
    });

    expect(onActivity).toHaveBeenCalledWith({ kind: 'thought', text: 'thinking' });
    expect(onTextChunk).toHaveBeenCalledWith('first ');
    expect(onTextChunk).toHaveBeenCalledWith('second');
    expect(onTextChunk).toHaveBeenCalledTimes(4);
    expect(stubAgentPort.promptCalls[1]).toBe('[AGENT_RESULT:DEVELOPER]\nfirst second');
    expect(delegateStubPort.activityListeners).toHaveLength(0);
  });

  it('should skip model configuration when the role has no default model', async () => {
    agentRegistry.getDefaultModel.mockReturnValue(undefined);
    stubAgentPort.mockResponses = ['Hi.'];

    await useCase.execute({
      channelId: 'ch-1',
      userId: 'user-1',
      prompt: 'Hi',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
    });

    expect(stubAgentPort.configCalls).toHaveLength(0);
  });

  it('should treat errors named PromptCancelledError as cancellation', async () => {
    const error = new Error('cancelled');
    error.name = 'PromptCancelledError';
    stubAgentPort.promptErrorToThrow = error;

    const result = await useCase.execute({
      channelId: 'ch-1',
      userId: 'user-1',
      prompt: 'Hi',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
    });

    expect(result.status).toBe('cancelled');
  });

  it('should stringify non-Error failures', async () => {
    stubAgentPort.connect = async () => {
      throw 'raw failure';
    };

    const result = await useCase.execute({
      channelId: 'ch-1',
      userId: 'user-1',
      prompt: 'Hi',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
    });

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('raw failure');
  });
});
