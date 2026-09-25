import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentActivity,
  AgentUpdate,
  AgentUsage,
} from '../../agent/ports/agent.port.js';
import { PromptCancelledError } from '../../agent/ports/agent.port.js';
import { InMemorySessionStoreAdapter } from '../adapters/in-memory-session-store.adapter.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { StubAgentPort } from '../testing/stub-agent.port.js';
import { ExecuteAgentTurnUseCase } from './execute-agent-turn.use-case.js';

class StubAgentRegistryPort implements IAgentRegistryPort {
  systemPromptToReturn: string | undefined = undefined;
  defaultModelToReturn: string | undefined = undefined;

  getSystemPrompt(): string | undefined {
    return this.systemPromptToReturn;
  }

  getDefaultModel(): string | undefined {
    return this.defaultModelToReturn;
  }
}

describe('ExecuteAgentTurnUseCase', () => {
  let useCase: ExecuteAgentTurnUseCase;
  let stubAgentPort: StubAgentPort;
  let sessionStore: InMemorySessionStoreAdapter;
  let stubRegistry: StubAgentRegistryPort;

  beforeEach(() => {
    stubAgentPort = new StubAgentPort();
    sessionStore = new InMemorySessionStoreAdapter();
    stubRegistry = new StubAgentRegistryPort();

    useCase = new ExecuteAgentTurnUseCase(
      stubAgentPort,
      sessionStore,
      stubRegistry,
    );
  });

  it('should execute first turn creating new session and prepending system prompt', async () => {
    stubRegistry.systemPromptToReturn = 'System instructions for developer';
    stubRegistry.defaultModelToReturn = 'claude-3-5-sonnet';
    stubAgentPort.lastAgentMessage = 'Turn completed successfully.';

    const expectedUsage: AgentUsage = {
      totalTokens: 150,
      inputTokens: 100,
      outputTokens: 50,
    };
    stubAgentPort.usageToReturn = expectedUsage;

    const messageUpdate: AgentUpdate = {
      sessionId: 'sess-test',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Turn completed successfully.' },
      },
    };
    stubAgentPort.updatesToYield = [messageUpdate];

    const activities: AgentActivity[] = [];
    const textChunks: string[] = [];

    const request: TurnRequest = {
      channelId: 'ch-1',
      threadId: 'th-1',
      userId: 'user-1',
      prompt: 'Hello agent!',
      workspacePath: '/repo/workspace',
      agentRole: 'DEVELOPER',
      onActivity: (activity) => activities.push(activity),
      onTextChunk: (chunk) => textChunks.push(chunk),
    };

    const result = await useCase.execute(request);

    expect(result.status).toBe('completed');
    expect(result.response).toBe('Turn completed successfully.');
    expect(result.usage).toEqual(expectedUsage);
    expect(result.sessionId).toBeDefined();

    expect(stubAgentPort.connectCalls).toBe(1);
    expect(stubAgentPort.createSessionCalls).toEqual(['/repo/workspace']);
    expect(stubAgentPort.configCalls).toEqual([
      { modelId: 'claude-3-5-sonnet' },
    ]);
    expect(stubAgentPort.promptCalls).toEqual([
      'System instructions for developer\n\nHello agent!',
    ]);
    expect(textChunks).toEqual(['Turn completed successfully.']);

    const storedSession = await sessionStore.findSession('ch-1', 'th-1');
    expect(storedSession).not.toBeNull();
    expect(storedSession?.channelId).toBe('ch-1');
    expect(storedSession?.threadId).toBe('th-1');
    expect(storedSession?.userId).toBe('user-1');
  });

  it('should execute subsequent turn without creating session again and without prepending system prompt', async () => {
    stubRegistry.systemPromptToReturn = 'System instructions for developer';
    stubAgentPort.currentSessionId = 'existing-session-id';
    stubAgentPort.lastAgentMessage = 'Second response';

    const firstRequest: TurnRequest = {
      channelId: 'ch-2',
      userId: 'user-2',
      prompt: 'First prompt',
      workspacePath: '/repo/workspace',
    };
    await useCase.execute(firstRequest);

    stubAgentPort.promptCalls = [];
    stubAgentPort.createSessionCalls = [];

    const secondRequest: TurnRequest = {
      channelId: 'ch-2',
      userId: 'user-2',
      prompt: 'Second prompt',
      workspacePath: '/repo/workspace',
    };
    const result = await useCase.execute(secondRequest);

    expect(result.status).toBe('completed');
    expect(result.response).toBe('Second response');
    expect(stubAgentPort.createSessionCalls).toHaveLength(0);
    expect(stubAgentPort.promptCalls).toEqual(['Second prompt']);
  });

  it('should not configure model if registry returns undefined', async () => {
    stubRegistry.defaultModelToReturn = undefined;
    stubAgentPort.lastAgentMessage = 'Ok';

    const request: TurnRequest = {
      channelId: 'ch-3',
      userId: 'user-3',
      prompt: 'Check model',
      workspacePath: '/repo/workspace',
    };

    await useCase.execute(request);

    expect(stubAgentPort.configCalls).toHaveLength(0);
  });

  it('should not prepend system prompt if registry returns undefined or whitespace', async () => {
    stubRegistry.systemPromptToReturn = '   ';
    stubAgentPort.lastAgentMessage = 'Ok';

    const request: TurnRequest = {
      channelId: 'ch-4',
      userId: 'user-4',
      prompt: 'Pure prompt',
      workspacePath: '/repo/workspace',
    };

    await useCase.execute(request);

    expect(stubAgentPort.promptCalls).toEqual(['Pure prompt']);
  });

  it('should stream different chunk formats and ignore non-text updates', async () => {
    const chunk1: AgentUpdate = {
      sessionId: 's',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Part 1. ' },
      },
    };
    const nonTextChunk = {
      sessionId: 's',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'bash',
      },
    } as unknown as AgentUpdate;
    const objectChunk = {
      text: 'Part 2. ',
    } as unknown as AgentUpdate;
    const rawStringChunk = 'Part 3.' as unknown as AgentUpdate;
    const invalidChunk = {
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'image' },
      },
    } as unknown as AgentUpdate;
    const nullChunk = null as unknown as AgentUpdate;

    stubAgentPort.updatesToYield = [
      chunk1,
      nonTextChunk,
      objectChunk,
      rawStringChunk,
      invalidChunk,
      nullChunk,
    ];

    const chunks: string[] = [];
    const request: TurnRequest = {
      channelId: 'ch-stream',
      userId: 'user-stream',
      prompt: 'Stream test',
      workspacePath: '/repo/workspace',
      onTextChunk: (chunk) => chunks.push(chunk),
    };

    const result = await useCase.execute(request);

    expect(chunks).toEqual(['Part 1. ', 'Part 2. ', 'Part 3.']);
    expect(result.response).toBe('Part 1. Part 2. Part 3.');
  });

  it('should relay activities and unsubscribe when turn completes', async () => {
    const activities: AgentActivity[] = [];
    const unsubscribeSpy = vi.fn();

    stubAgentPort.onActivity = vi.fn(
      (listener: (activity: AgentActivity) => void) => {
        stubAgentPort.activityListeners.push(listener);
        return unsubscribeSpy;
      },
    );

    const request: TurnRequest = {
      channelId: 'ch-activity',
      userId: 'user-activity',
      prompt: 'Activity test',
      workspacePath: '/repo/workspace',
      onActivity: (activity) => activities.push(activity),
    };

    await useCase.execute(request);

    expect(unsubscribeSpy).toHaveBeenCalled();
  });

  it('should handle PromptCancelledError returning cancelled status and usage', async () => {
    stubAgentPort.errorToThrowOnPrompt = new PromptCancelledError();
    stubAgentPort.lastAgentMessage = 'Partial response before cancel';
    stubAgentPort.usageToReturn = {
      totalTokens: 20,
      inputTokens: 15,
      outputTokens: 5,
    };

    const request: TurnRequest = {
      channelId: 'ch-cancel',
      userId: 'user-cancel',
      prompt: 'Will be cancelled',
      workspacePath: '/repo/workspace',
    };

    const result = await useCase.execute(request);

    expect(result.status).toBe('cancelled');
    expect(result.response).toBe('Partial response before cancel');
    expect(result.usage?.totalTokens).toBe(20);
  });

  it('should handle custom error with name PromptCancelledError and usage fetch failure', async () => {
    const customCancelError = new Error('Cancelled by steering');
    customCancelError.name = 'PromptCancelledError';
    stubAgentPort.errorToThrowOnPrompt = customCancelError;

    stubAgentPort.getLastRoundUsage = vi
      .fn()
      .mockRejectedValue(new Error('Usage unavailable'));

    const request: TurnRequest = {
      channelId: 'ch-cancel-duck',
      userId: 'user-cancel-duck',
      prompt: 'Will be cancelled duck typing',
      workspacePath: '/repo/workspace',
    };

    const result = await useCase.execute(request);

    expect(result.status).toBe('cancelled');
    expect(result.usage).toBeUndefined();
  });

  it('should return empty sessionId when PromptCancelledError occurs before session resolution', async () => {
    sessionStore.findSession = vi
      .fn()
      .mockRejectedValue(new PromptCancelledError());

    const request: TurnRequest = {
      channelId: 'ch-pre-cancel',
      userId: 'user-pre-cancel',
      prompt: 'Will be cancelled early',
      workspacePath: '/repo/workspace',
    };

    const result = await useCase.execute(request);

    expect(result.status).toBe('cancelled');
    expect(result.sessionId).toBe('');
  });

  it('should handle general Error returning failed status with errorMessage and sessionId', async () => {
    stubAgentPort.errorToThrowOnConnect = new Error('Transport connect failed');

    const request: TurnRequest = {
      channelId: 'ch-fail',
      userId: 'user-fail',
      prompt: 'Will fail',
      workspacePath: '/repo/workspace',
    };

    const result = await useCase.execute(request);

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('Transport connect failed');
    expect(result.sessionId).not.toBe('');
  });

  it('should return empty sessionId when failure happens before session is initialized', async () => {
    sessionStore.findSession = vi
      .fn()
      .mockRejectedValue(new Error('Store connection refused'));

    const request: TurnRequest = {
      channelId: 'ch-pre-fail',
      userId: 'user-pre-fail',
      prompt: 'Will fail in store',
      workspacePath: '/repo/workspace',
    };

    const result = await useCase.execute(request);

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('Store connection refused');
    expect(result.sessionId).toBe('');
  });

  it('should handle non-Error thrown exception returning failed status', async () => {
    stubAgentPort.connect = vi.fn().mockRejectedValue('Fatal network panic');

    const request: TurnRequest = {
      channelId: 'ch-fail-raw',
      userId: 'user-fail-raw',
      prompt: 'Will fail raw',
      workspacePath: '/repo/workspace',
    };

    const result = await useCase.execute(request);

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('Fatal network panic');
  });
});
