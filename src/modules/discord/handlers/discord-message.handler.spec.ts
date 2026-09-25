import type { Client, Message, User } from 'discord.js';
import { Events } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TurnRequest } from '../../orchestrator/models/turn-request.model.js';
import type { TurnResult } from '../../orchestrator/models/turn-result.model.js';
import type { OrchestratorService } from '../../orchestrator/services/orchestrator.service.js';
import { DiscordActivityFormatter } from '../formatters/discord-activity.formatter.js';
import { DiscordClientService } from '../services/discord-client.service.js';

import { DiscordMessageHandler } from './discord-message.handler.js';


class StubOrchestratorService implements Partial<OrchestratorService> {
  lastRequest?: TurnRequest;
  mockResult: TurnResult = {
    sessionId: 'session-1',
    response: 'Hello from agent!',
    status: 'completed',
  };

  throwError = false;

  async executeTurn(request: TurnRequest): Promise<TurnResult> {
    this.lastRequest = request;
    if (this.throwError) {
      throw new Error('Orchestration failed');
    }
    return this.mockResult;
  }

  async cancelTurn(): Promise<void> {
    return undefined;
  }
}

describe('DiscordMessageHandler', () => {
  let mockClient: Client;
  let clientService: DiscordClientService;
  let orchestratorService: StubOrchestratorService;
  let formatter: DiscordActivityFormatter;
  let handler: DiscordMessageHandler;

  const botUser = { id: 'bot-123', username: 'AgentBot' } as User;

  beforeEach(() => {
    mockClient = {
      user: botUser,
      on: vi.fn(),
    } as unknown as Client;

    clientService = new DiscordClientService(mockClient);
    orchestratorService = new StubOrchestratorService();
    formatter = new DiscordActivityFormatter();
    handler = new DiscordMessageHandler(
      clientService,
      orchestratorService as unknown as OrchestratorService,
      formatter,
    );
  });

  it('should register messageCreate listener on onModuleInit and invoke handleMessage', () => {
    let messageListener: ((msg: Message) => void) | undefined;
    vi.mocked(mockClient.on).mockImplementation(((event: string, cb: any) => {
      if (event === Events.MessageCreate) {
        messageListener = cb;
      }
      return mockClient;
    }) as any);

    handler.onModuleInit();
    expect(messageListener).toBeDefined();

    const ignoredBotMessage = {
      author: { bot: true },
    } as unknown as Message;
    messageListener?.(ignoredBotMessage);
  });

  it('should ignore messages from bot authors', async () => {
    const message = {
      author: { bot: true, id: 'other-bot' },
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(orchestratorService.lastRequest).toBeUndefined();
  });

  it('should ignore messages if client user is not defined', async () => {
    (mockClient as any).user = null;
    const message = {
      author: { bot: false, id: 'user-1' },
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: { isThread: vi.fn().mockReturnValue(false) },
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(orchestratorService.lastRequest).toBeUndefined();
  });

  it('should ignore message if not in thread and bot is not mentioned', async () => {
    const message = {
      author: { bot: false, id: 'user-1' },
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: { isThread: vi.fn().mockReturnValue(false) },
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(orchestratorService.lastRequest).toBeUndefined();
  });

  it('should ignore message in thread not owned by bot and bot not mentioned', async () => {
    const message = {
      author: { bot: false, id: 'user-1' },
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: {
        isThread: vi.fn().mockReturnValue(true),
        ownerId: 'someone-else',
      },
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(orchestratorService.lastRequest).toBeUndefined();
  });

  it('should start thread, clean prompt, and send response for non-thread message with mention', async () => {
    const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const mockThread = {
      id: 'thread-999',
      send: vi.fn().mockResolvedValue(progressMessage),
    };

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Fix bug in auth service',
      content: '<@!bot-123> Fix bug in auth service',
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: { isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(message.startThread).toHaveBeenCalledWith({
      name: 'Fix bug in auth service',
      autoArchiveDuration: 60,
    });
    expect(orchestratorService.lastRequest).toMatchObject({
      channelId: 'channel-1',
      threadId: 'thread-999',
      userId: 'user-42',
      prompt: 'Fix bug in auth service',
      agentRole: 'CEO',
    });
    expect(mockThread.send).toHaveBeenCalledWith('Hello from agent!');
  });

  it('should process message in existing thread owned by bot without starting new thread', async () => {
    const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const existingThread = {
      id: 'thread-888',
      parentId: 'channel-main',
      ownerId: 'bot-123',
      isThread: vi.fn().mockReturnValue(true),
      send: vi.fn().mockResolvedValue(progressMessage),
    };

    const message = {
      author: { bot: false, id: 'user-42' },
      content: 'Run tests now',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: existingThread,
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(orchestratorService.lastRequest).toMatchObject({
      channelId: 'channel-main',
      threadId: 'thread-888',
      prompt: 'Run tests now',
    });
  });

  it('should fallback to threadId as channelId if parentId is not present on thread', async () => {
    const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const existingThread = {
      id: 'thread-888',
      parentId: undefined,
      ownerId: 'bot-123',
      isThread: vi.fn().mockReturnValue(true),
      send: vi.fn().mockResolvedValue(progressMessage),
    };

    const message = {
      author: { bot: false, id: 'user-42' },
      content: 'Check status',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: existingThread,
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(orchestratorService.lastRequest?.channelId).toBe('thread-888');
  });

  it('should reply with prompt request if message content has no prompt after cleaning', async () => {
    const mockThread = {
      id: 'thread-999',
      send: vi.fn().mockResolvedValue({}),
    };

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: '',
      content: '<@!bot-123>',
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: { isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(mockThread.send).toHaveBeenCalledWith(
      'Olá! Como posso te ajudar hoje? Por favor, envie uma instrução ou tarefa.',
    );
    expect(orchestratorService.lastRequest).toBeUndefined();
  });

  it('should update progress message via throttler when onActivity fires', async () => {
    const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const mockThread = {
      id: 'thread-999',
      send: vi.fn().mockResolvedValue(progressMessage),
    };

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Plan work',
      content: '<@bot-123> Plan work',
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: { isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    let activityCallback: any;
    orchestratorService.executeTurn = vi
      .fn()
      .mockImplementation(async (req) => {
        activityCallback = req.onActivity;
        activityCallback({
          kind: 'thought',
          id: 't-1',
          text: 'Planning the architecture...',
        });
        return {
          sessionId: 'session-1',
          response: 'Plan completed.',
          status: 'completed',
        };
      });

    await handler.handleMessage(message);

    expect(progressMessage.edit).toHaveBeenCalled();
  });

  it('should handle edit error in progressMessage without breaking the flow', async () => {
    const progressMessage = {
      edit: vi
        .fn()
        .mockRejectedValue(new Error('Rate limit or permission denied')),
    };
    const mockThread = {
      id: 'thread-999',
      send: vi.fn().mockResolvedValue(progressMessage),
    };

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Plan work',
      content: '<@bot-123> Plan work',
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: { isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    orchestratorService.executeTurn = vi
      .fn()
      .mockImplementation(async (req) => {
        req.onActivity({
          kind: 'tool',
          toolCallId: 'c1',
          title: 'git status',
          status: 'in_progress',
        });
        return {
          sessionId: 'session-1',
          response: 'Done.',
          status: 'completed',
        };
      });

    await expect(handler.handleMessage(message)).resolves.toBeUndefined();
    expect(mockThread.send).toHaveBeenCalledWith('Done.');
  });

  it('should send default completion message when response is empty', async () => {
    const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const mockThread = {
      id: 'thread-999',
      send: vi.fn().mockResolvedValue(progressMessage),
    };

    orchestratorService.mockResult = {
      sessionId: 'session-1',
      response: '',
      status: 'completed',
    };

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Silent command',
      content: '<@bot-123> Silent command',
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: { isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(mockThread.send).toHaveBeenCalledWith(
      '✅ *Tarefa concluída sem mensagem de resposta.*',
    );
  });

  it('should send cancellation message when status is cancelled', async () => {
    const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const mockThread = {
      id: 'thread-999',
      send: vi.fn().mockResolvedValue(progressMessage),
    };

    orchestratorService.mockResult = {
      sessionId: 'session-1',
      response: '',
      status: 'cancelled',
    };

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Stop',
      content: '<@bot-123> Stop',
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: { isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(mockThread.send).toHaveBeenCalledWith(
      '⚠️ **Turno cancelado pelo usuário.**',
    );
  });

  it('should send error message when status is failed', async () => {
    const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const mockThread = {
      id: 'thread-999',
      send: vi.fn().mockResolvedValue(progressMessage),
    };

    orchestratorService.mockResult = {
      sessionId: 'session-1',
      response: '',
      status: 'failed',
      errorMessage: 'Workspace not found',
    };

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Crash',
      content: '<@bot-123> Crash',
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: { isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(mockThread.send).toHaveBeenCalledWith(
      '❌ **Erro na execução**: Workspace not found',
    );
  });

  it('should handle thrown error in execution and send friendly error message to thread', async () => {
    const mockThread = {
      id: 'thread-999',
      send: vi
        .fn()
        .mockRejectedValueOnce(new Error('Discord API 500'))
        .mockResolvedValueOnce({}),
    };

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Crash test',
      content: '<@bot-123> Crash test',
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: { isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(mockThread.send).toHaveBeenCalledWith(
      '❌ **Ocorreu um erro ao processar sua solicitação:** Discord API 500',
    );
  });

  it('should handle raw string error during execution', async () => {
    const mockThread = {
      id: 'thread-999',
      send: vi
        .fn()
        .mockRejectedValueOnce('raw string error')
        .mockResolvedValueOnce({}),
    };

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Crash test',
      content: '<@!bot-123> Crash test',
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: { isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(mockThread.send).toHaveBeenCalledWith(
      '❌ **Ocorreu um erro ao processar sua solicitação:** raw string error',
    );
  });

  it('should handle error when startThread fails before thread is created', async () => {
    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Thread failure',
      content: '<@!bot-123> Thread failure',
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: { isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockRejectedValue(new Error('Cannot create thread')),
    } as unknown as Message;

    await expect(handler.handleMessage(message)).resolves.toBeUndefined();
  });
});
