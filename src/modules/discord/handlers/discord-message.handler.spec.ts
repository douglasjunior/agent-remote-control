import { Test, type TestingModule } from '@nestjs/testing';
import { Events, type Message, type ThreadChannel } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentActivity } from '../../agent/ports/agent.port.js';
import type { ConversationInputResolution } from '../../orchestrator/models/agent-config-outcome.model.js';
import type { TurnAttachment } from '../../orchestrator/models/turn-attachment.model.js';
import type { TurnRequest } from '../../orchestrator/models/turn-request.model.js';
import type { TurnResult } from '../../orchestrator/models/turn-result.model.js';
import { OrchestratorService } from '../../orchestrator/services/orchestrator.service.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import { DiscordActivityFormatter } from '../formatters/discord-activity.formatter.js';
import {
  type AttachmentValidationResult,
  type DiscordAttachment,
  DiscordAttachmentService,
} from '../services/discord-attachment.service.js';
import { DiscordClientService } from '../services/discord-client.service.js';

import { DiscordMessageHandler } from './discord-message.handler.js';


class MockDiscordAttachmentService {
  public validationResult: AttachmentValidationResult = { valid: true };
  public downloadedAttachments: TurnAttachment[] = [
    {
      name: 'diagram.png',
      path: '/tmp/attachments/diagram.png',
      contentType: 'image/png',
      size: 1024,
    },
  ];

  public downloadError: Error | null = null;

  validateAttachments = vi.fn().mockImplementation((_attachments: readonly DiscordAttachment[]) => this.validationResult);
  downloadAttachments = vi.fn().mockImplementation(async () => {
    if (this.downloadError) {
      throw this.downloadError;
    }
    return this.downloadedAttachments;
  });
}

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

  public activitiesToEmit: AgentActivity[] = [];

  public queued = false;
  public activeSelection = false;
  public resolution: ConversationInputResolution | null = null;
  public resolvedInputs: { channelId: string; threadId?: string; prompt: string }[] = [];

  public selectionLookups: { channelId: string; threadId?: string }[] = [];

  async hasActiveConfigSelection(channelId: string, threadId?: string): Promise<boolean> {
    this.selectionLookups.push({ channelId, threadId });
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
  let attachmentService: MockDiscordAttachmentService;
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
          provide: DiscordAttachmentService,
          useClass: MockDiscordAttachmentService,
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
    attachmentService = module.get(DiscordAttachmentService);
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
      isDMBased: vi.fn().mockReturnValue(false),
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

  it('should send messages when activities are emitted', async () => {
    orchestratorService.activitiesToEmit = [
      { kind: 'thought', id: '1', text: 'Thinking about the request' },
      {
        kind: 'tool',
        title: 'Running bash command',
        toolCallId: 'call-1',
        status: 'in_progress',
      },
    ];
    const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const mockThread = {
      id: 'thread-1',
      parentId: 'channel-1',
      ownerId: 'bot-123',
      isDMBased: vi.fn().mockReturnValue(false),
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

    const sendCalls = (mockThread.send as any).mock.calls.map((call: any) => call[0]);
    expect(sendCalls.some((c: string) => typeof c === 'string' && c.includes('Thinking about the request'))).toBe(true);
    expect(sendCalls.some((c: string) => typeof c === 'string' && c.includes('Running bash command'))).toBe(true);
  });

  it('should ignore @everyone and role mentions when checking for the bot mention', async () => {
    const has = vi.fn().mockReturnValue(false);
    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      content: '@everyone hello',
      mentions: { has },
      channel: { isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false) },
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
      isDMBased: vi.fn().mockReturnValue(false),
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
      isDMBased: vi.fn().mockReturnValue(false),
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
    it('should replace a growing thought in place instead of appending each update', async () => {
      orchestratorService.activitiesToEmit = [
        { kind: 'thought', id: 't1', text: 'Hello' },
        { kind: 'thought', id: 't1', text: 'Hello there' },
        { kind: 'thought', id: 't1', text: 'Hello there, friend', final: true },
      ];
      const sentMessages: { content: string; edit: ReturnType<typeof vi.fn> }[] = [];
      const mockThread = {
        id: 'thread-1',
        parentId: 'channel-1',
        ownerId: 'bot-123',
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(true),
        send: vi.fn().mockImplementation(async (content: string) => {
          const sent = { content, edit: vi.fn().mockResolvedValue(undefined) };
          sentMessages.push(sent);
          return sent;
        }),
      } as unknown as ThreadChannel;
      const message = {
        author: { bot: false, id: 'user-42' },
        channelId: 'channel-1',
        cleanContent: 'Hi',
        content: 'Hi',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: mockThread,
      } as unknown as Message;

      await handler.handleMessage(message);
      await vi.runAllTimersAsync();

      const thoughtMsg = sentMessages.find(m => typeof m.content === 'string' && m.content.includes('Hello'));
      expect(thoughtMsg).toBeDefined();
      expect(thoughtMsg!.edit).toHaveBeenCalledWith('> 💭 *Hello there, friend*');
    });

    it('should update tool calls in place and drop removed thoughts', async () => {
      const sentMessages: {
        content: string;
        edit: ReturnType<typeof vi.fn>;
        delete: ReturnType<typeof vi.fn>;
      }[] = [];
      const mockThread = {
        id: 'thread-1',
        parentId: 'channel-1',
        ownerId: 'bot-123',
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(true),
        send: vi.fn().mockImplementation(async (content: string) => {
          const sent = {
            content,
            edit: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(undefined),
          };
          sentMessages.push(sent);
          return sent;
        }),
      } as unknown as ThreadChannel;
      const message = {
        author: { bot: false, id: 'user-42' },
        channelId: 'channel-1',
        cleanContent: 'Hi',
        content: 'Hi',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: mockThread,
      } as unknown as Message;

      vi.spyOn(orchestratorService, 'executeTurn').mockImplementation(async (req) => {
        req.onActivity?.({ kind: 'thought', id: 't1', text: 'Draft' });
        await vi.advanceTimersByTimeAsync(1500);
        req.onActivity?.({ kind: 'tool', toolCallId: 'c1', title: 'ls', status: 'in_progress' });
        req.onActivity?.({
          kind: 'tool',
          toolCallId: 'c1',
          title: 'ls',
          status: 'completed',
          details: 'file1.txt',
        });
        req.onActivity?.({ kind: 'thought', id: 't1', text: 'Draft', removed: true });
        req.onActivity?.({ kind: 'cancelled', id: 'x' });
        return orchestratorService.mockResult;
      });

      await handler.handleMessage(message);
      await vi.runAllTimersAsync();

      const toolMsg = sentMessages.find(m => typeof m.content === 'string' && m.content.includes('Executando'));
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.edit).toHaveBeenCalledWith('✅ **Concluído**: `ls`\n```\nfile1.txt\n```');

      const thoughtMsg = sentMessages.find(m => typeof m.content === 'string' && m.content.includes('Draft'));
      expect(thoughtMsg).toBeDefined();
      expect(thoughtMsg!.delete).toHaveBeenCalled();
    });

    it('should announce delegations and deliver thoughts and tool calls as individual messages', async () => {
      const sentMessages: { content: string; edit: ReturnType<typeof vi.fn> }[] = [];
      const mockThread = {
        id: 'thread-1',
        parentId: 'channel-1',
        ownerId: 'bot-123',
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(true),
        send: vi.fn(async (content: string) => {
          const sent = { content, edit: vi.fn().mockResolvedValue(undefined) };
          sentMessages.push(sent);
          return sent;
        }),
      } as unknown as ThreadChannel;
      const message = {
        author: { bot: false, id: 'user-42' },
        channelId: 'channel-1',
        content: 'Hi',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: mockThread,
      } as unknown as Message;
      const delegation = {
        round: 1,
        role: 'DEVELOPER',
        roleName: 'Desenvolvedor',
        projectName: 'my-app',
      };
      orchestratorService.executeTurn = async (request: TurnRequest) => {
        request.onActivity?.({ kind: 'thought', id: 'ceo-1', text: 'Planning' });
        request.onDelegation?.({ ...delegation, phase: 'started' });
        request.onActivity?.({ kind: 'tool', toolCallId: 'c1', title: 'ls', status: 'in_progress' });
        request.onActivity?.({ kind: 'tool', toolCallId: 'c1', title: 'ls', status: 'completed' });
        request.onDelegation?.({
          ...delegation,
          phase: 'finished',
          response: 'Listed files.',
          agentInfo: { roleName: 'Desenvolvedor', agentName: 'agy' },
          durationMs: 3_000,
        });
        request.onActivity?.({ kind: 'thought', id: 'ceo-2', text: 'Reviewing' });
        return { sessionId: 'session-1', response: 'Done.', status: 'completed' };
      };

      await handler.handleMessage(message);
      await vi.runAllTimersAsync();

      const contents = sentMessages.map(sent => sent.content);
      expect(contents).toContain('⏳ *Iniciando processamento...*');
      expect(contents).toContain(
        '🔀 **Tarefa delegada** ao agente **Desenvolvedor** (`DEVELOPER`) no projeto `my-app` — ele assumiu a tarefa agora.',
      );
      expect(contents).toContain(
        '📋 **Resposta do agente Desenvolvedor** (`DEVELOPER`):\nListed files.\n-# 🤖 Desenvolvedor (agy) · 🧠 padrão · ⚡ padrão · ⏱️ 3.0s',
      );
      expect(contents).toContain(
        '↩️ **Desenvolvedor concluiu** — o CEO está revisando o resultado.',
      );
      expect(contents).toContain('Done.');
    });

    it('should proceed gracefully when a delegation cannot be announced', async () => {
      const send = vi.fn().mockImplementation(async (content: string) => ({
        content,
        edit: vi.fn().mockResolvedValue(undefined),
      }));
      const mockThread = {
        id: 'thread-1',
        parentId: 'channel-1',
        ownerId: 'bot-123',
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(true),
        send,
      } as unknown as ThreadChannel;
      const message = {
        author: { bot: false, id: 'user-42' },
        channelId: 'channel-1',
        content: 'Hi',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: mockThread,
      } as unknown as Message;
      orchestratorService.executeTurn = async (request: TurnRequest) => {
        send.mockImplementation(async (content: string) => {
          if (typeof content === 'string' && content.includes('delegada')) {
            throw new Error('rate limited');
          }
          return { content, edit: vi.fn().mockResolvedValue(undefined) };
        });
        request.onDelegation?.({
          round: 1,
          role: 'DEVELOPER',
          roleName: 'Desenvolvedor',
          phase: 'started',
        });
        request.onActivity?.({ kind: 'tool', toolCallId: 'c1', title: 'ls', status: 'completed' });
        return { sessionId: 'session-1', response: 'Done.', status: 'completed' };
      };

      await handler.handleMessage(message);
      await vi.runAllTimersAsync();

      expect(send).toHaveBeenLastCalledWith('Done.');
    });

    it('should delete initial progress message only once when onActivity and onDelegation fire concurrently', async () => {
      let resolveDelete!: () => void;
      const deletePromise = new Promise<void>((resolve) => {
        resolveDelete = resolve;
      });
      const deleteFn = vi.fn().mockImplementation(() => deletePromise);
      const send = vi.fn().mockImplementation(async (content: string) => ({
        content,
        edit: vi.fn().mockResolvedValue(undefined),
        delete: deleteFn,
      }));
      const mockThread = {
        id: 'thread-1',
        parentId: 'channel-1',
        ownerId: 'bot-123',
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(true),
        send,
      } as unknown as ThreadChannel;
      const message = {
        author: { bot: false, id: 'user-42' },
        channelId: 'channel-1',
        content: 'Hi',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: mockThread,
      } as unknown as Message;

      orchestratorService.executeTurn = async (request: TurnRequest) => {
        request.onActivity?.({ kind: 'thought', id: 't1', text: 'Thinking' });
        request.onDelegation?.({
          round: 1,
          role: 'DEVELOPER',
          roleName: 'Desenvolvedor',
          phase: 'started',
        });
        resolveDelete();
        return { sessionId: 'session-1', response: 'Done.', status: 'completed' };
      };

      await handler.handleMessage(message);
      await vi.runAllTimersAsync();

      expect(deleteFn).toHaveBeenCalledTimes(1);
    });

    it('should skip activities without formatted content', async () => {
      orchestratorService.activitiesToEmit = [
        { kind: 'thought', id: 't1', text: '   ' },
        { kind: 'tool', toolCallId: 't2', title: 'ls', status: 'unknown' as any },
      ];
      const sendMock = vi.fn().mockResolvedValue({
        edit: vi.fn().mockResolvedValue(undefined),
      });
      const mockThread = {
        id: 'thread-1',
        parentId: 'channel-1',
        ownerId: 'bot-123',
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(true),
        send: sendMock,
      } as unknown as ThreadChannel;
      const message = {
        author: { bot: false, id: 'user-42' },
        channelId: 'channel-1',
        cleanContent: 'Hi',
        content: 'Hi',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: mockThread,
      } as unknown as Message;

      await handler.handleMessage(message);
      await vi.runAllTimersAsync();

      const sentContents = sendMock.mock.calls.map(c => c[0]);
      expect(sentContents.some(c => typeof c === 'string' && c.startsWith('> 💭'))).toBe(false);
    });

    it('should split thoughts exceeding 2000 characters into multiple messages', async () => {
      const longLines = Array.from({ length: 60 }, (_, i) => `Thought line ${i + 1} with lots of details to extend length`);
      orchestratorService.activitiesToEmit = [{ kind: 'thought', id: 't1', text: longLines.join('\n') }];
      const sentMessages: { content: string }[] = [];
      const mockThread = {
        id: 'thread-1',
        parentId: 'channel-1',
        ownerId: 'bot-123',
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(true),
        send: vi.fn().mockImplementation(async (content: string) => {
          const sent = { content, edit: vi.fn().mockResolvedValue(undefined) };
          sentMessages.push(sent);
          return sent;
        }),
      } as unknown as ThreadChannel;
      const message = {
        author: { bot: false, id: 'user-42' },
        channelId: 'channel-1',
        cleanContent: 'Hi',
        content: 'Hi',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: mockThread,
      } as unknown as Message;

      await handler.handleMessage(message);
      await vi.runAllTimersAsync();

      const thoughtMessages = sentMessages.filter(
        m => typeof m.content === 'string' && (m.content.startsWith('> 💭') || m.content.startsWith('> *')),
      );
      expect(thoughtMessages.length).toBeGreaterThan(1);
      expect(thoughtMessages.every(m => m.content.length <= 2000)).toBe(true);
    });

    it('should send completed tool call directly when not preceded by in_progress', async () => {
      orchestratorService.activitiesToEmit = [{ kind: 'tool', toolCallId: 'direct-1', title: 'pwd', status: 'completed' }];
      const sentMessages: { content: string }[] = [];
      const mockThread = {
        id: 'thread-1',
        parentId: 'channel-1',
        ownerId: 'bot-123',
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(true),
        send: vi.fn().mockImplementation(async (content: string) => {
          const sent = { content, edit: vi.fn().mockResolvedValue(undefined) };
          sentMessages.push(sent);
          return sent;
        }),
      } as unknown as ThreadChannel;
      const message = {
        author: { bot: false, id: 'user-42' },
        channelId: 'channel-1',
        cleanContent: 'Hi',
        content: 'Hi',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: mockThread,
      } as unknown as Message;

      await handler.handleMessage(message);
      await vi.runAllTimersAsync();

      expect(sentMessages.some(m => typeof m.content === 'string' && m.content.includes('✅ **Concluído**: `pwd`'))).toBe(true);
    });

    it('should format failed tool call with details', async () => {
      orchestratorService.activitiesToEmit = [
        { kind: 'tool', toolCallId: 'fail-1', title: 'npm build', status: 'in_progress' },
        { kind: 'tool', toolCallId: 'fail-1', title: 'npm build', status: 'failed', details: 'exit code 1' },
      ];
      const sentMessages: { content: string; edit: ReturnType<typeof vi.fn> }[] = [];
      const mockThread = {
        id: 'thread-1',
        parentId: 'channel-1',
        ownerId: 'bot-123',
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(true),
        send: vi.fn().mockImplementation(async (content: string) => {
          const sent = { content, edit: vi.fn().mockResolvedValue(undefined) };
          sentMessages.push(sent);
          return sent;
        }),
      } as unknown as ThreadChannel;
      const message = {
        author: { bot: false, id: 'user-42' },
        channelId: 'channel-1',
        cleanContent: 'Hi',
        content: 'Hi',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: mockThread,
      } as unknown as Message;

      await handler.handleMessage(message);
      await vi.runAllTimersAsync();

      const toolMsg = sentMessages.find(m => typeof m.content === 'string' && m.content.includes('Executando'));
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.edit).toHaveBeenCalledWith('❌ **Falhou**: `npm build`\n```\nexit code 1\n```');
    });
  });

  it('should swallow error when tool call message update fails', async () => {
    orchestratorService.activitiesToEmit = [
      { kind: 'tool', toolCallId: 't1', title: 'git status', status: 'in_progress' },
      { kind: 'tool', toolCallId: 't1', title: 'git status', status: 'completed' },
    ];
    const mockMsg = { edit: vi.fn().mockRejectedValue(new Error('Discord API Error')) };
    const mockThread = {
      id: 'thread-1',
      parentId: 'channel-1',
      ownerId: 'bot-123',
      isDMBased: vi.fn().mockReturnValue(false),
      isThread: vi.fn().mockReturnValue(true),
      send: vi.fn().mockResolvedValue(mockMsg),
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

  it('should log warning when tool message edit throws a non-Error string', async () => {
    orchestratorService.activitiesToEmit = [
      { kind: 'tool', toolCallId: 't1', title: 'git status', status: 'in_progress' },
      { kind: 'tool', toolCallId: 't1', title: 'git status', status: 'completed' },
    ];
    const mockMsg = { edit: vi.fn().mockRejectedValue('String error from Discord API') };
    const mockThread = {
      id: 'thread-1',
      parentId: 'channel-1',
      ownerId: 'bot-123',
      isDMBased: vi.fn().mockReturnValue(false),
      isThread: vi.fn().mockReturnValue(true),
      send: vi.fn().mockResolvedValue(mockMsg),
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

  it('should log warning when tool message initial send fails', async () => {
    orchestratorService.activitiesToEmit = [{ kind: 'tool', toolCallId: 't1', title: 'git status', status: 'in_progress' }];
    let sendCount = 0;
    const mockThread = {
      id: 'thread-1',
      parentId: 'channel-1',
      ownerId: 'bot-123',
      isDMBased: vi.fn().mockReturnValue(false),
      isThread: vi.fn().mockReturnValue(true),
      send: vi.fn().mockImplementation(async () => {
        sendCount++;
        if (sendCount === 2) {
          throw new Error('Send failed');
        }
        return { edit: vi.fn().mockResolvedValue(undefined) };
      }),
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

  it('should log warning when thought message send fails', async () => {
    orchestratorService.activitiesToEmit = [{ kind: 'thought', id: 't1', text: 'Hello' }];
    let sendCount = 0;
    const mockThread = {
      id: 'thread-1',
      parentId: 'channel-1',
      ownerId: 'bot-123',
      isDMBased: vi.fn().mockReturnValue(false),
      isThread: vi.fn().mockReturnValue(true),
      send: vi.fn().mockImplementation(async () => {
        sendCount++;
        if (sendCount === 2) {
          throw new Error('Thought send failed');
        }
        return { edit: vi.fn().mockResolvedValue(undefined) };
      }),
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

  it('should log warning when thought message edit fails', async () => {
    orchestratorService.activitiesToEmit = [
      { kind: 'thought', id: 't1', text: 'Hello' },
      { kind: 'thought', id: 't1', text: 'Hello world' },
    ];
    const mockMsg = { edit: vi.fn().mockRejectedValue(new Error('Edit failed')), content: '' };
    let sendCount = 0;
    const mockThread = {
      id: 'thread-1',
      parentId: 'channel-1',
      ownerId: 'bot-123',
      isDMBased: vi.fn().mockReturnValue(false),
      isThread: vi.fn().mockReturnValue(true),
      send: vi.fn().mockImplementation(async () => {
        sendCount++;
        if (sendCount === 2) {
          return mockMsg;
        }
        return { edit: vi.fn().mockResolvedValue(undefined) };
      }),
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
      channel: { isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false) },
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
      channel: { isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false) },
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
      channel: { isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false) },
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
      channel: { isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(mockThread.send).toHaveBeenCalledWith(
      '❌ **Erro na execução**: Workspace not found',
    );
  });

  it('should attach files to single chunk completed turn result', async () => {
    const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const mockThread = {
      id: 'thread-999',
      send: vi.fn().mockResolvedValue(progressMessage),
    };

    orchestratorService.mockResult = {
      sessionId: 'session-1',
      response: 'Here is the report.',
      status: 'completed',
      attachments: ['/path/to/report.pdf'],
    };

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Get report',
      content: '<@bot-123> Get report',
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: { isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(mockThread.send).toHaveBeenCalledWith({
      content: 'Here is the report.',
      files: ['/path/to/report.pdf'],
    });
  });

  it('should attach files only to the last chunk of a multi-chunk response', async () => {
    const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const mockThread = {
      id: 'thread-999',
      send: vi.fn().mockResolvedValue(progressMessage),
    };

    orchestratorService.mockResult = {
      sessionId: 'session-1',
      response: 'A'.repeat(3000),
      status: 'completed',
      attachments: ['/path/to/screenshot.png'],
    };

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Long task with files',
      content: '<@bot-123> Long task with files',
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: { isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(mockThread.send).toHaveBeenCalledWith('A'.repeat(2000));
    expect(mockThread.send).toHaveBeenCalledWith({
      content: 'A'.repeat(1000),
      files: ['/path/to/screenshot.png'],
    });
  });

  it('should send plain string message when attachments is empty array', async () => {
    const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const mockThread = {
      id: 'thread-999',
      send: vi.fn().mockResolvedValue(progressMessage),
    };

    orchestratorService.mockResult = {
      sessionId: 'session-1',
      response: 'Task done.',
      status: 'completed',
      attachments: [],
    };

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Get report',
      content: '<@bot-123> Get report',
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: { isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(mockThread.send).toHaveBeenCalledWith('Task done.');
  });

  it('should fall back to sending plain text message when sending with attachments fails', async () => {
    const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const mockThread = {
      id: 'thread-999',
      send: vi
        .fn()
        .mockResolvedValueOnce(progressMessage)
        .mockRejectedValueOnce(new Error('File could not be found'))
        .mockResolvedValueOnce(undefined),
    };

    orchestratorService.mockResult = {
      sessionId: 'session-1',
      response: 'Here is the report.',
      status: 'completed',
      attachments: ['/path/to/invalid-folder'],
    };

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Get report',
      content: '<@bot-123> Get report',
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: { isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(mockThread.send).toHaveBeenCalledWith({
      content: 'Here is the report.',
      files: ['/path/to/invalid-folder'],
    });
    expect(mockThread.send).toHaveBeenCalledWith('Here is the report.');
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
      channel: { isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false) },
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
      channel: { isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false) },
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
      channel: { isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false) },
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
        isDMBased: vi.fn().mockReturnValue(false),
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

    it('should show the token usage in the footer', async () => {
      const send = vi.fn().mockResolvedValue({ edit: vi.fn().mockResolvedValue(undefined) });
      orchestratorService.mockResult = {
        sessionId: 'session-1',
        response: 'Done.',
        status: 'completed',
        agentInfo,
        usage: { totalTokens: 12_345, inputTokens: 10_000, outputTokens: 2_345 },
      };

      await handler.handleMessage(threadMessage(send));

      expect(send).toHaveBeenLastCalledWith(`Done.\n${footer} · 🪙 12.3k tokens`);
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
        isDMBased: vi.fn().mockReturnValue(false),
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

    const unmanagedThreadMessage = (send: ReturnType<typeof vi.fn>) => ({
      author: { bot: false, id: 'user-42' },
      channelId: 'thread-9',
      content: ' 1 ',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: {
        id: 'thread-9',
        parentId: 'channel-1',
        ownerId: 'someone-else',
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(true),
        send,
      },
    }) as unknown as Message;

    it('should accept an answer without mention in an unmanaged thread with an active selection', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      orchestratorService.activeSelection = true;
      orchestratorService.resolution = { kind: 'configured', settings };

      await handler.handleMessage(unmanagedThreadMessage(send));

      expect(orchestratorService.selectionLookups).toEqual([{ channelId: 'channel-1', threadId: 'thread-9' }]);
      expect(orchestratorService.resolvedInputs).toEqual([{ channelId: 'channel-1', threadId: 'thread-9', prompt: '1' }]);
      expect(send).toHaveBeenCalledWith('✅ **Configuração salva**: 🧠 Model 1 · ⚡ padrão');
    });

    it('should ignore messages without mention in an unmanaged thread without a selection', async () => {
      const send = vi.fn();

      await handler.handleMessage(unmanagedThreadMessage(send));

      expect(orchestratorService.resolvedInputs).toEqual([]);
      expect(send).not.toHaveBeenCalled();
    });

    it('should ignore messages without mention in a plain channel even with a selection open', async () => {
      const send = vi.fn();
      const startThread = vi.fn();
      orchestratorService.activeSelection = true;
      const message = {
        author: { bot: false, id: 'user-7' },
        channelId: 'channel-1',
        content: 'just chatting',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: { isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false), send },
        startThread,
      } as unknown as Message;

      await handler.handleMessage(message);

      expect(orchestratorService.selectionLookups).toEqual([]);
      expect(startThread).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('typing indicator', () => {
    it('should start typing indicator when turn starts and stop when completed', async () => {
      const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
      const sendTyping = vi.fn().mockResolvedValue(undefined);
      let typingCallsDuringTurn = 0;

      const mockThread = {
        id: 'thread-1',
        parentId: 'channel-1',
        ownerId: 'bot-123',
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(true),
        send: vi.fn().mockResolvedValue(progressMessage),
        sendTyping,
      } as unknown as ThreadChannel;

      const message = {
        author: { bot: false, id: 'user-42' },
        channelId: 'channel-1',
        cleanContent: 'Run task',
        content: 'Run task',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: mockThread,
      } as unknown as Message;

      orchestratorService.executeTurn = async () => {
        typingCallsDuringTurn = sendTyping.mock.calls.length;
        return {
          sessionId: 'session-1',
          response: 'Done',
          status: 'completed',
        };
      };

      await handler.handleMessage(message);

      expect(typingCallsDuringTurn).toBe(1);
      const callsAfterTurn = sendTyping.mock.calls.length;

      vi.advanceTimersByTime(20000);
      expect(sendTyping).toHaveBeenCalledTimes(callsAfterTurn);
    });

    it('should keep typing indicator alive on activity', async () => {
      const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
      const sendTyping = vi.fn().mockResolvedValue(undefined);

      const mockThread = {
        id: 'thread-1',
        parentId: 'channel-1',
        ownerId: 'bot-123',
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(true),
        send: vi.fn().mockResolvedValue(progressMessage),
        sendTyping,
      } as unknown as ThreadChannel;

      const message = {
        author: { bot: false, id: 'user-42' },
        channelId: 'channel-1',
        cleanContent: 'Run task',
        content: 'Run task',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: mockThread,
      } as unknown as Message;

      orchestratorService.executeTurn = async (request: TurnRequest) => {
        vi.advanceTimersByTime(4 * 60 * 1000);
        request.onActivity?.({ kind: 'thought', id: '1', text: 'thinking' });
        vi.advanceTimersByTime(2 * 60 * 1000);
        expect(sendTyping).toHaveBeenCalled();
        return {
          sessionId: 'session-1',
          response: 'Done',
          status: 'completed',
        };
      };

      await handler.handleMessage(message);
    });

    it('should keep typing indicator alive on delegation', async () => {
      const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
      const sendTyping = vi.fn().mockResolvedValue(undefined);

      const mockThread = {
        id: 'thread-1',
        parentId: 'channel-1',
        ownerId: 'bot-123',
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(true),
        send: vi.fn().mockResolvedValue(progressMessage),
        sendTyping,
      } as unknown as ThreadChannel;

      const message = {
        author: { bot: false, id: 'user-42' },
        channelId: 'channel-1',
        cleanContent: 'Run task',
        content: 'Run task',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: mockThread,
      } as unknown as Message;

      orchestratorService.executeTurn = async (request: TurnRequest) => {
        vi.advanceTimersByTime(4 * 60 * 1000);
        request.onDelegation?.({
          round: 1,
          role: 'DEVELOPER',
          roleName: 'Desenvolvedor',
          phase: 'started',
        });
        vi.advanceTimersByTime(2 * 60 * 1000);
        expect(sendTyping).toHaveBeenCalled();
        return {
          sessionId: 'session-1',
          response: 'Done',
          status: 'completed',
        };
      };

      await handler.handleMessage(message);
    });

    it('should stop typing indicator if executeTurn throws', async () => {
      const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
      const sendTyping = vi.fn().mockResolvedValue(undefined);

      const mockThread = {
        id: 'thread-1',
        parentId: 'channel-1',
        ownerId: 'bot-123',
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(true),
        send: vi.fn().mockResolvedValue(progressMessage),
        sendTyping,
      } as unknown as ThreadChannel;

      const message = {
        author: { bot: false, id: 'user-42' },
        channelId: 'channel-1',
        cleanContent: 'Run task',
        content: 'Run task',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: mockThread,
      } as unknown as Message;

      orchestratorService.executeTurn = async () => {
        throw new Error('Fatal error');
      };

      await handler.handleMessage(message);

      const callCount = sendTyping.mock.calls.length;
      vi.advanceTimersByTime(20000);
      expect(sendTyping).toHaveBeenCalledTimes(callCount);
    });

    it('should stop typing indicator when turn is cancelled', async () => {
      const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
      const sendTyping = vi.fn().mockResolvedValue(undefined);

      const mockThread = {
        id: 'thread-1',
        parentId: 'channel-1',
        ownerId: 'bot-123',
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(true),
        send: vi.fn().mockResolvedValue(progressMessage),
        sendTyping,
      } as unknown as ThreadChannel;

      const message = {
        author: { bot: false, id: 'user-42' },
        channelId: 'channel-1',
        cleanContent: 'Cancel task',
        content: 'Cancel task',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: mockThread,
      } as unknown as Message;

      orchestratorService.executeTurn = async () => ({
        sessionId: 'session-1',
        response: '',
        status: 'cancelled',
      });

      await handler.handleMessage(message);

      const callCount = sendTyping.mock.calls.length;
      vi.advanceTimersByTime(20000);
      expect(sendTyping).toHaveBeenCalledTimes(callCount);
    });
  });

  describe('attachments handling', () => {
    const createAttachment = (name: string, contentType = 'image/png'): DiscordAttachment => ({
      name,
      url: `https://cdn.discordapp.com/attachments/1/2/${name}`,
      contentType,
      size: 1024,
    });

    const createThreadMessageWithAttachments = (
      content: string,
      attachmentsList: DiscordAttachment[],
    ) => {
      const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
      const send = vi.fn().mockResolvedValue(progressMessage);
      const mockThread = {
        id: 'thread-att-1',
        parentId: 'channel-1',
        ownerId: 'bot-123',
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(true),
        send,
      } as unknown as ThreadChannel;

      const attachmentsMap = new Map(
        attachmentsList.map((att, idx) => [`id-${idx}`, att]),
      );

      const message = {
        author: { bot: false, id: 'user-42', username: 'alice' },
        channelId: 'channel-1',
        cleanContent: content,
        content,
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: mockThread,
        attachments: attachmentsMap,
      } as unknown as Message;

      return { message, mockThread, send };
    };

    it('should process message with only attachments using default prompt', async () => {
      const { message, mockThread } = createThreadMessageWithAttachments('', [createAttachment('diagram.png')]);

      await handler.handleMessage(message);

      expect(attachmentService.validateAttachments).toHaveBeenCalledWith([expect.objectContaining({ name: 'diagram.png' })]);
      expect(attachmentService.downloadAttachments).toHaveBeenCalledWith(
        'channel-1:thread-att-1',
        [expect.objectContaining({ name: 'diagram.png' })],
      );
      expect(orchestratorService.lastRequest).toMatchObject({
        channelId: 'channel-1',
        threadId: 'thread-att-1',
        prompt: 'O usuário enviou anexos. Analise os arquivos anexados.',
        attachments: [
          expect.objectContaining({
            name: 'diagram.png',
            path: '/tmp/attachments/diagram.png',
          }),
        ],
      });
      expect(mockThread.send).toHaveBeenCalledWith('Hello from agent!');
    });

    it('should process message with both text prompt and attachments', async () => {
      const { message } = createThreadMessageWithAttachments('Analise a imagem', [createAttachment('schema.png')]);

      await handler.handleMessage(message);

      expect(orchestratorService.lastRequest).toMatchObject({
        channelId: 'channel-1',
        threadId: 'thread-att-1',
        prompt: 'Analise a imagem',
        attachments: [
          expect.objectContaining({
            name: 'diagram.png',
            path: '/tmp/attachments/diagram.png',
          }),
        ],
      });
    });

    it('should reject message with invalid attachments and not invoke executeTurn', async () => {
      attachmentService.validationResult = {
        valid: false,
        reason: '⚠️ O arquivo "virus.exe" possui um formato não suportado ou incompatível com as ferramentas do agente.',
      };

      const { message, mockThread } = createThreadMessageWithAttachments('', [createAttachment('virus.exe', 'application/x-msdownload')]);

      await handler.handleMessage(message);

      expect(mockThread.send).toHaveBeenCalledWith(
        '⚠️ O arquivo "virus.exe" possui um formato não suportado ou incompatível com as ferramentas do agente.',
      );
      expect(orchestratorService.lastRequest).toBeUndefined();
    });

    it('should report error to channel when attachment download fails', async () => {
      attachmentService.downloadError = new Error('Falha no download da CDN do Discord');

      const { message, mockThread } = createThreadMessageWithAttachments('Ver anexo', [createAttachment('broken.png')]);

      await handler.handleMessage(message);

      expect(mockThread.send).toHaveBeenCalledWith(
        '❌ **Ocorreu um erro ao processar sua solicitação:** Falha no download da CDN do Discord',
      );
      expect(orchestratorService.lastRequest).toBeUndefined();
    });

    it('should send greeting when prompt is empty and attachments map is empty', async () => {
      const { message, mockThread } = createThreadMessageWithAttachments('', []);

      await handler.handleMessage(message);

      expect(mockThread.send).toHaveBeenCalledWith(
        'Olá! Como posso te ajudar hoje? Por favor, envie uma instrução ou tarefa.',
      );
      expect(orchestratorService.lastRequest).toBeUndefined();
    });
  });
});
