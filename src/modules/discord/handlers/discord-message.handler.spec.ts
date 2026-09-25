import { Test, type TestingModule } from '@nestjs/testing';
import { Events, type Message, type ThreadChannel } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentActivity } from '../../agent/ports/agent.port.js';
import type { ConversationInputResolution } from '../../orchestrator/models/agent-config-outcome.model.js';
import type { TurnRequest } from '../../orchestrator/models/turn-request.model.js';
import type { TurnResult } from '../../orchestrator/models/turn-result.model.js';
import { OrchestratorService } from '../../orchestrator/services/orchestrator.service.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import { DiscordActivityFormatter } from '../formatters/discord-activity.formatter.js';
import { DiscordClientService } from '../services/discord-client.service.js';

import { DiscordMessageHandler } from './discord-message.handler.js';


class MockDiscordClientService {
  public mockClient = {
    user: { id: 'bot-123' },
    on: vi.fn(),
  };

  getClient() {
    return this.mockClient;
  }
}

class MockOrchestratorService {
  public lastRequest?: TurnRequest;
  public mockResult: TurnResult = {
    sessionId: 'session-1',
    response: 'Hello from agent!',
    status: 'completed',
  };

  public activitiesToEmit: AgentActivity[] = [
    { kind: 'thought', id: '1', text: 'Thinking about the request' },
    {
      kind: 'tool',
      title: 'Running bash command',
      toolCallId: 'call-1',
      status: 'in_progress',
    },
  ];

  public queued = false;
  public activeSelection = false;
  public resolution: ConversationInputResolution | null = null;
  public resolvedInputs: { channelId: string; threadId?: string; prompt: string }[] = [];

  async hasActiveConfigSelection(): Promise<boolean> {
    return this.activeSelection;
  }

  async resolveInput(input: {
    channelId: string;
    threadId?: string;
    prompt: string;
  }): Promise<ConversationInputResolution> {
    this.resolvedInputs.push(input);
    return this.resolution ?? { kind: 'execute', prompt: input.prompt };
  }

  async executeTurn(request: TurnRequest): Promise<TurnResult> {
    this.lastRequest = request;
    if (this.queued) {
      request.onQueued?.();
    }
    for (const activity of this.activitiesToEmit) {
      request.onActivity?.(activity);
    }
    return this.mockResult;
  }
}

class MockWorkspacePort implements IWorkspacePort {
  getBaseDirectory = vi.fn().mockReturnValue('/mock/workspace');
  resolveRepositoryPath = vi.fn();
  ensureDirectory = vi.fn().mockResolvedValue(undefined);
  registerRepository = vi.fn();
  getRepository = vi.fn();
  listRepositories = vi.fn();
  hasRepository = vi.fn();
}

describe('DiscordMessageHandler', () => {
  let handler: DiscordMessageHandler;
  let discordClientService: MockDiscordClientService;
  let orchestratorService: MockOrchestratorService;
  let workspacePort: MockWorkspacePort;

  beforeEach(async () => {
    vi.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordMessageHandler,
        DiscordActivityFormatter,
        {
          provide: DiscordClientService,
          useClass: MockDiscordClientService,
        },
        {
          provide: OrchestratorService,
          useClass: MockOrchestratorService,
        },
        {
          provide: IWorkspacePort,
          useClass: MockWorkspacePort,
        },
      ],
    }).compile();

    handler = module.get<DiscordMessageHandler>(DiscordMessageHandler);
    discordClientService = module.get(DiscordClientService);
    orchestratorService = module.get(OrchestratorService);
    workspacePort = module.get(IWorkspacePort);
  });

  it('should register message create event on module init', () => {
    handler.onModuleInit();
    expect(discordClientService.mockClient.on).toHaveBeenCalledWith(
      Events.MessageCreate,
      expect.any(Function),
    );
  });

  it('should delegate registered message create events to handleMessage', () => {
    const handleMessage = vi.spyOn(handler, 'handleMessage').mockResolvedValue();
    handler.onModuleInit();
    const listener = discordClientService.mockClient.on.mock.calls[0]![1] as (message: Message) => void;
    const message = { author: { bot: true } } as Message;

    listener(message);

    expect(handleMessage).toHaveBeenCalledWith(message);
  });

  it('should ignore messages from bots', async () => {
    const message = {
      author: { bot: true },
    } as Message;
    await handler.handleMessage(message);
    expect(orchestratorService.lastRequest).toBeUndefined();
  });

  it('should ignore messages when client user is not ready', async () => {
    discordClientService.mockClient.user = null as any;
    const message = {
      author: { bot: false },
    } as Message;
    await handler.handleMessage(message);
    expect(orchestratorService.lastRequest).toBeUndefined();
  });

  it('should ignore messages that are neither DM, thread, nor mention', async () => {
    const message = {
      author: { bot: false },
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: {
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(false),
      },
    } as unknown as Message;
    await handler.handleMessage(message);
    expect(orchestratorService.lastRequest).toBeUndefined();
  });

  it('should handle message in existing managed thread', async () => {
    const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const mockThread = {
      id: 'thread-1',
      parentId: 'channel-1',
      ownerId: 'bot-123',
      isThread: vi.fn().mockReturnValue(true),
      send: vi.fn().mockResolvedValue(progressMessage),
    } as unknown as ThreadChannel;

    const message = {
      author: { bot: false, id: 'user-42', username: 'john' },
      channelId: 'channel-1',
      cleanContent: 'Do something',
      content: 'Do something',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: mockThread,
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(orchestratorService.lastRequest).toMatchObject({
      channelId: 'channel-1',
      threadId: 'thread-1',
      userId: 'user-42',
      prompt: 'Do something',
      agentRole: 'CEO',
      workspacePath: '/mock/workspace',
    });
    expect(mockThread.send).toHaveBeenCalledWith('Hello from agent!');
    expect(workspacePort.getBaseDirectory).toHaveBeenCalled();
  });

  it('should spawn a new thread if bot is mentioned in a normal channel', async () => {
    const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const mockThread = {
      id: 'thread-new',
      send: vi.fn().mockResolvedValue(progressMessage),
    };

    const message = {
      author: { bot: false, id: 'user-42', username: 'john' },
      channelId: 'channel-1',
      cleanContent: 'Fix the bug',
      content: '<@bot-123> Fix the bug',
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: {
        isThread: vi.fn().mockReturnValue(false),
        isDMBased: vi.fn().mockReturnValue(false),
      },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(message.startThread).toHaveBeenCalledWith({
      name: 'Fix the bug',
      autoArchiveDuration: 60,
    });
    expect(orchestratorService.lastRequest).toMatchObject({
      channelId: 'channel-1',
      threadId: 'thread-new',
      userId: 'user-42',
      prompt: 'Fix the bug',
      agentRole: 'CEO',
      workspacePath: '/mock/workspace',
    });
    expect(mockThread.send).toHaveBeenCalledWith('Hello from agent!');
  });

  it('should reply with greeting if prompt is empty in normal channel', async () => {
    const mockThread = {
      id: 'thread-new',
      send: vi.fn().mockResolvedValue({}),
    };

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: '',
      content: '<@bot-123>   ',
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: {
        isThread: vi.fn().mockReturnValue(false),
        isDMBased: vi.fn().mockReturnValue(false),
      },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(mockThread.send).toHaveBeenCalledWith(
      'Olá! Como posso te ajudar hoje? Por favor, envie uma instrução ou tarefa.',
    );
    expect(orchestratorService.lastRequest).toBeUndefined();
  });

  it('should update progress message when activities are emitted', async () => {
    const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const mockThread = {
      id: 'thread-1',
      parentId: 'channel-1',
      ownerId: 'bot-123',
      isThread: vi.fn().mockReturnValue(true),
      send: vi.fn().mockResolvedValue(progressMessage),
    } as unknown as ThreadChannel;

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Update me',
      content: 'Update me',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: mockThread,
    } as unknown as Message;

    await handler.handleMessage(message);
    await vi.runAllTimersAsync();

    expect(progressMessage.edit).toHaveBeenCalled();
    const editCalls = progressMessage.edit.mock.calls.map(call => call[0]);
    expect(editCalls.some((c: string) => c.includes('Thinking about the request'))).toBe(true);
    expect(editCalls.some((c: string) => c.includes('Running bash command'))).toBe(true);
  });

  it('should ignore @everyone and role mentions when checking for the bot mention', async () => {
    const has = vi.fn().mockReturnValue(false);
    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      content: '@everyone hello',
      mentions: { has },
      channel: { isThread: vi.fn().mockReturnValue(false) },
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(has).toHaveBeenCalledWith(
      discordClientService.mockClient.user,
      { ignoreEveryone: true, ignoreRoles: true },
    );
    expect(orchestratorService.lastRequest).toBeUndefined();
  });

  it('should tell the user when the message is waiting for the previous turn', async () => {
    orchestratorService.queued = true;
    const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const mockThread = {
      id: 'thread-1',
      parentId: 'channel-1',
      ownerId: 'bot-123',
      isThread: vi.fn().mockReturnValue(true),
      send: vi.fn().mockResolvedValue(progressMessage),
    } as unknown as ThreadChannel;
    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      content: 'Next task',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: mockThread,
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(progressMessage.edit).toHaveBeenCalledWith(
      '⏳ *Aguardando a tarefa anterior desta conversa terminar...*',
    );
  });

  it('should ignore failures when showing the queued notice', async () => {
    orchestratorService.queued = true;
    orchestratorService.activitiesToEmit = [];
    const progressMessage = { edit: vi.fn().mockRejectedValue(new Error('gone')) };
    const mockThread = {
      id: 'thread-1',
      parentId: 'channel-1',
      ownerId: 'bot-123',
      isThread: vi.fn().mockReturnValue(true),
      send: vi.fn().mockResolvedValue(progressMessage),
    } as unknown as ThreadChannel;
    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      content: 'Next task',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: mockThread,
    } as unknown as Message;

    await expect(handler.handleMessage(message)).resolves.toBeUndefined();
    expect(mockThread.send).toHaveBeenCalledWith('Hello from agent!');
  });

  describe('progress feed', () => {
    const buildThreadMessage = () => {
      const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
      const mockThread = {
        id: 'thread-1',
        parentId: 'channel-1',
        ownerId: 'bot-123',
        isThread: vi.fn().mockReturnValue(true),
        send: vi.fn().mockResolvedValue(progressMessage),
      } as unknown as ThreadChannel;
      const message = {
        author: { bot: false, id: 'user-42' },
        channelId: 'channel-1',
        cleanContent: 'Hi',
        content: 'Hi',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: mockThread,
      } as unknown as Message;
      return { message, progressMessage };
    };

    const lastEdit = (progressMessage: { edit: ReturnType<typeof vi.fn> }): string =>
      progressMessage.edit.mock.calls.at(-1)![0] as string;

    it('should replace a growing thought in place instead of appending each update', async () => {
      orchestratorService.activitiesToEmit = [
        { kind: 'thought', id: 't1', text: 'Hello' },
        { kind: 'thought', id: 't1', text: 'Hello there' },
        { kind: 'thought', id: 't1', text: 'Hello there, friend', final: true },
      ];
      const { message, progressMessage } = buildThreadMessage();

      await handler.handleMessage(message);
      await vi.runAllTimersAsync();

      expect(lastEdit(progressMessage)).toBe('🤖 **Progresso do Agente**:\n> 💭 *Hello there, friend*');
    });

    it('should update tool calls in place and drop removed thoughts', async () => {
      orchestratorService.activitiesToEmit = [
        { kind: 'thought', id: 't1', text: 'Draft' },
        { kind: 'tool', toolCallId: 'c1', title: 'ls', status: 'in_progress' },
        { kind: 'tool', toolCallId: 'c1', title: 'ls', status: 'completed' },
        { kind: 'thought', id: 't1', text: 'Draft', removed: true },
        { kind: 'cancelled', id: 'x' },
      ];
      const { message, progressMessage } = buildThreadMessage();

      await handler.handleMessage(message);
      await vi.runAllTimersAsync();

      expect(lastEdit(progressMessage)).toBe('🤖 **Progresso do Agente**:\n✅ **Concluído**: `ls`');
    });

    it('should skip activities without formatted content', async () => {
      orchestratorService.activitiesToEmit = [{ kind: 'thought', id: 't1', text: '   ' }];
      const { message, progressMessage } = buildThreadMessage();

      await handler.handleMessage(message);
      await vi.runAllTimersAsync();

      expect(progressMessage.edit).not.toHaveBeenCalled();
    });

    it('should keep the progress message within the Discord length limit', async () => {
      const longText = 'x'.repeat(5000);
      orchestratorService.activitiesToEmit = [{ kind: 'thought', id: 't1', text: longText }];
      const { message, progressMessage } = buildThreadMessage();

      await handler.handleMessage(message);
      await vi.runAllTimersAsync();

      expect(lastEdit(progressMessage).length).toBeLessThanOrEqual(2000);
    });
  });

  it('should swallow error when progress message update fails', async () => {
    const progressMessage = {
      edit: vi.fn().mockRejectedValue(new Error('Discord API Error')),
    };
    const mockThread = {
      id: 'thread-1',
      parentId: 'channel-1',
      ownerId: 'bot-123',
      isThread: vi.fn().mockReturnValue(true),
      send: vi.fn().mockResolvedValue(progressMessage),
    } as unknown as ThreadChannel;

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Update me',
      content: 'Update me',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: mockThread,
    } as unknown as Message;

    await expect(handler.handleMessage(message)).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
  });

  it('should log warning when progress message update throws a non-Error string', async () => {
    const progressMessage = {
      edit: vi.fn().mockRejectedValue('String error from Discord API'),
    };
    const mockThread = {
      id: 'thread-1',
      parentId: 'channel-1',
      ownerId: 'bot-123',
      isThread: vi.fn().mockReturnValue(true),
      send: vi.fn().mockResolvedValue(progressMessage),
    } as unknown as ThreadChannel;

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Update me',
      content: 'Update me',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: mockThread,
    } as unknown as Message;

    await expect(handler.handleMessage(message)).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
  });

  it('should split long responses into multiple chunks', async () => {
    const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const mockThread = {
      id: 'thread-999',
      send: vi.fn().mockResolvedValue(progressMessage),
    };

    orchestratorService.mockResult = {
      sessionId: 'session-1',
      response: 'A'.repeat(3000),
      status: 'completed',
    };

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Long task',
      content: '<@bot-123> Long task',
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: { isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(mockThread.send).toHaveBeenCalledWith('A'.repeat(2000));
    expect(mockThread.send).toHaveBeenCalledWith('A'.repeat(1000));
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
      cleanContent: 'Silent task',
      content: '<@bot-123> Silent task',
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

  it('should process direct message (DM) without requiring mention or thread', async () => {
    const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const dmChannel = {
      isDMBased: vi.fn().mockReturnValue(true),
      isThread: vi.fn().mockReturnValue(false),
      send: vi.fn().mockResolvedValue(progressMessage),
    };

    const message = {
      author: { bot: false, id: 'user-dm-1' },
      channelId: 'dm-channel-1',
      cleanContent: 'Create a new feature',
      content: 'Create a new feature',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: dmChannel,
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(orchestratorService.lastRequest).toMatchObject({
      channelId: 'dm-channel-1',
      threadId: undefined,
      userId: 'user-dm-1',
      prompt: 'Create a new feature',
      agentRole: 'CEO',
    });
    expect(dmChannel.send).toHaveBeenCalledWith('Hello from agent!');
  });

  it('should reply with greeting when direct message has empty prompt', async () => {
    const dmChannel = {
      isDMBased: vi.fn().mockReturnValue(true),
      isThread: vi.fn().mockReturnValue(false),
      send: vi.fn().mockResolvedValue({}),
    };

    const message = {
      author: { bot: false, id: 'user-dm-1' },
      channelId: 'dm-channel-1',
      content: '   ',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: dmChannel,
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(dmChannel.send).toHaveBeenCalledWith(
      'Olá! Como posso te ajudar hoje? Por favor, envie uma instrução ou tarefa.',
    );
    expect(orchestratorService.lastRequest).toBeUndefined();
  });

  it('should send error to DM channel when processing direct message fails', async () => {
    const dmChannel = {
      isDMBased: vi.fn().mockReturnValue(true),
      isThread: vi.fn().mockReturnValue(false),
      send: vi
        .fn()
        .mockRejectedValueOnce(new Error('Internal failure'))
        .mockResolvedValueOnce({}),
    };

    const message = {
      author: { bot: false, id: 'user-dm-1' },
      channelId: 'dm-channel-1',
      content: 'Help me',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: dmChannel,
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(dmChannel.send).toHaveBeenCalledWith(
      '❌ **Ocorreu um erro ao processar sua solicitação:** Internal failure',
    );
  });

  it('should swallow error if sending error notification to targetChannel fails', async () => {
    const dmChannel = {
      isDMBased: vi.fn().mockReturnValue(true),
      isThread: vi.fn().mockReturnValue(false),
      send: vi
        .fn()
        .mockRejectedValue(new Error('Network failure on send error notification')),
    };

    const message = {
      author: { bot: false, id: 'user-dm-1' },
      channelId: 'dm-channel-1',
      content: 'Help me',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: dmChannel,
    } as unknown as Message;

    await expect(handler.handleMessage(message)).resolves.toBeUndefined();
  });

  it('should ignore direct message if channel does not support send', async () => {
    const dmChannelWithoutSend = {
      isDMBased: vi.fn().mockReturnValue(true),
      isThread: vi.fn().mockReturnValue(false),
    };

    const message = {
      author: { bot: false, id: 'user-dm-1' },
      channelId: 'dm-channel-1',
      content: 'Hello',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: dmChannelWithoutSend,
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(orchestratorService.lastRequest).toBeUndefined();
  });

  describe('agent footer', () => {
    const agentInfo = { roleName: 'CEO', agentName: 'agy', modelName: 'Deep', effortName: 'High' };
    const footer = '-# 🤖 CEO (agy) · 🧠 Deep · ⚡ High';

    const threadMessage = (send: ReturnType<typeof vi.fn>) => ({
      author: { bot: false, id: 'user-42' },
      channelId: 'thread-1',
      content: 'Do it',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: {
        id: 'thread-1',
        parentId: 'channel-1',
        ownerId: 'bot-123',
        isThread: vi.fn().mockReturnValue(true),
        send,
      },
    }) as unknown as Message;

    it('should append the footer only to the last chunk of a long response', async () => {
      const send = vi.fn().mockResolvedValue({ edit: vi.fn().mockResolvedValue(undefined) });
      orchestratorService.mockResult = {
        sessionId: 'session-1',
        response: 'A'.repeat(3000),
        status: 'completed',
        agentInfo,
      };

      await handler.handleMessage(threadMessage(send));

      const sent = send.mock.calls.map(call => call[0] as string).slice(1);
      expect(sent).toHaveLength(2);
      expect(sent[0]).not.toContain(footer);
      expect(sent[1]!.endsWith(`\n${footer}`)).toBe(true);
      expect(sent.every(text => text.length <= 2000)).toBe(true);
    });

    it('should split a long failure message and keep the footer on the last chunk', async () => {
      const send = vi.fn().mockResolvedValue({ edit: vi.fn().mockResolvedValue(undefined) });
      orchestratorService.mockResult = {
        sessionId: 'session-1',
        response: '',
        status: 'failed',
        errorMessage: 'stderr line\n'.repeat(400),
        agentInfo,
      };

      await handler.handleMessage(threadMessage(send));

      const sent = send.mock.calls.map(call => call[0] as string).slice(1);
      expect(sent.length).toBeGreaterThan(1);
      expect(sent[0]!.startsWith('❌ **Erro na execução**: stderr line')).toBe(true);
      expect(sent.slice(0, -1).some(text => text.includes(footer))).toBe(false);
      expect(sent.at(-1)!.endsWith(`\n${footer}`)).toBe(true);
      expect(sent.every(text => text.length <= 2000)).toBe(true);
    });

    it('should split a long error thrown while processing the message', async () => {
      const send = vi.fn().mockResolvedValue({ edit: vi.fn().mockResolvedValue(undefined) });
      orchestratorService.executeTurn = async () => {
        throw new Error('trace line\n'.repeat(400));
      };

      await handler.handleMessage(threadMessage(send));

      const sent = send.mock.calls.map(call => call[0] as string).slice(1);
      expect(sent.length).toBeGreaterThan(1);
      expect(sent[0]!.startsWith('❌ **Ocorreu um erro ao processar sua solicitação:** trace line')).toBe(true);
      expect(sent.every(text => text.length <= 2000)).toBe(true);
    });

    it.each([
      ['completed without text', { response: '', status: 'completed' }, '✅ *Tarefa concluída sem mensagem de resposta.*'],
      ['cancelled', { response: '', status: 'cancelled' }, '⚠️ **Turno cancelado pelo usuário.**'],
      ['failed', { response: '', status: 'failed', errorMessage: 'boom' }, '❌ **Erro na execução**: boom'],
    ] as const)('should append the footer when the turn is %s', async (_label, partial, text) => {
      const send = vi.fn().mockResolvedValue({ edit: vi.fn().mockResolvedValue(undefined) });
      orchestratorService.mockResult = { sessionId: 'session-1', ...partial, agentInfo };

      await handler.handleMessage(threadMessage(send));

      expect(send).toHaveBeenLastCalledWith(`${text}\n${footer}`);
    });
  });

  describe('agent configuration selection', () => {
    const selection = {
      channelId: 'channel-1',
      threadId: 'thread-1',
      step: 'model' as const,
      options: [{ index: 1, id: 'm1', label: 'Model 1' }],
    };
    const settings = {
      modelId: 'm1',
      modelName: 'Model 1',
      effortId: null,
      effortName: null,
      updatedAt: '',
    };

    const threadMessage = (send: ReturnType<typeof vi.fn>, content = '1') => ({
      author: { bot: false, id: 'user-42' },
      channelId: 'thread-1',
      content,
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: {
        id: 'thread-1',
        parentId: 'channel-1',
        ownerId: 'bot-123',
        isThread: vi.fn().mockReturnValue(true),
        send,
      },
    }) as unknown as Message;

    it('should show the options instead of running the turn', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      orchestratorService.resolution = { kind: 'selection', selection };

      await handler.handleMessage(threadMessage(send, 'Build it'));

      expect(orchestratorService.resolvedInputs).toEqual([{ channelId: 'channel-1', threadId: 'thread-1', prompt: 'Build it' }]);
      expect(send).toHaveBeenCalledWith(expect.stringContaining('**1.** Model 1'));
      expect(orchestratorService.lastRequest).toBeUndefined();
    });

    it('should repeat the options on an invalid answer', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      orchestratorService.resolution = { kind: 'invalid', selection };

      await handler.handleMessage(threadMessage(send, 'abc'));

      expect(send).toHaveBeenCalledWith(expect.stringMatching(/^⚠️ Opção inválida/));
      expect(orchestratorService.lastRequest).toBeUndefined();
    });

    it('should confirm a configuration without pending prompt', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      orchestratorService.resolution = { kind: 'configured', settings };

      await handler.handleMessage(threadMessage(send));

      expect(send).toHaveBeenCalledWith('✅ **Configuração salva**: 🧠 Model 1 · ⚡ padrão');
      expect(orchestratorService.lastRequest).toBeUndefined();
    });

    it('should confirm the configuration and run the pending prompt', async () => {
      const send = vi.fn().mockResolvedValue({ edit: vi.fn().mockResolvedValue(undefined) });
      orchestratorService.resolution = { kind: 'execute', prompt: 'Build it', configured: settings };

      await handler.handleMessage(threadMessage(send));

      expect(send.mock.calls[0]![0]).toBe('✅ **Configuração salva**: 🧠 Model 1 · ⚡ padrão');
      expect(orchestratorService.lastRequest?.prompt).toBe('Build it');
    });

    it('should accept an answer in a plain channel with an active selection without opening a thread', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      const startThread = vi.fn();
      orchestratorService.activeSelection = true;
      orchestratorService.resolution = { kind: 'configured', settings };
      const message = {
        author: { bot: false, id: 'user-42' },
        channelId: 'channel-1',
        content: ' 1 ',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: { isThread: vi.fn().mockReturnValue(false), send },
        startThread,
      } as unknown as Message;

      await handler.handleMessage(message);

      expect(startThread).not.toHaveBeenCalled();
      expect(orchestratorService.resolvedInputs).toEqual([{ channelId: 'channel-1', threadId: undefined, prompt: '1' }]);
      expect(send).toHaveBeenCalledWith('✅ **Configuração salva**: 🧠 Model 1 · ⚡ padrão');
    });
  });
});
