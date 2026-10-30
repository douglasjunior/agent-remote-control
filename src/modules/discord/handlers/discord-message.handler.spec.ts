import { Test, type TestingModule } from '@nestjs/testing';
import { Events, type Message, type ThreadChannel } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentActivity } from '../../agent/ports/agent.port.js';
import type { ConversationInputResolution } from '../../orchestrator/models/agent-config-outcome.model.js';
import type { TurnAttachment } from '../../orchestrator/models/turn-attachment.model.js';
import type { TurnRequest } from '../../orchestrator/models/turn-request.model.js';
import type { TurnResult } from '../../orchestrator/models/turn-result.model.js';
import type { QuestionPrompt } from '../../orchestrator/models/user-question.model.js';
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
  public resolvedInputs: { conversationId: string; prompt: string }[] = [];

  public selectionLookups: string[] = [];

  public pendingQuestions = false;

  hasPendingQuestions(_conversationId: string): boolean {
    return this.pendingQuestions;
  }

  public pendingLanguageChange = false;

  hasPendingLanguageChange(_conversationId: string): boolean {
    return this.pendingLanguageChange;
  }

  async hasActiveConfigSelection(conversationId: string): Promise<boolean> {
    this.selectionLookups.push(conversationId);
    return this.activeSelection;
  }

  async resolveInput(input: {
    conversationId: string;
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
  listProjectFolders = vi.fn().mockResolvedValue([]);
  writeFile = vi.fn().mockResolvedValue(undefined);
  ensureSymlink = vi.fn().mockResolvedValue(undefined);
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
      conversationId: 'channel-1:thread-1',
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
      conversationId: 'channel-1:thread-new',
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
      'Hi! How can I help you today? Please send an instruction or task.',
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
      '⏳ *Waiting for the previous task in this conversation to finish...*',
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

      const toolMsg = sentMessages.find(m => typeof m.content === 'string' && m.content.includes('Running'));
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.edit).toHaveBeenCalledWith('✅ **Completed**: `ls`\n```\nfile1.txt\n```');

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
        roleName: 'Developer',
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
          agentInfo: { roleName: 'Developer', agentName: 'agy' },
          durationMs: 3_000,
        });
        request.onActivity?.({ kind: 'thought', id: 'ceo-2', text: 'Reviewing' });
        return { sessionId: 'session-1', response: 'Done.', status: 'completed' };
      };

      await handler.handleMessage(message);
      await vi.runAllTimersAsync();

      const contents = sentMessages.map(sent => sent.content);
      expect(contents).toContain('⏳ *Starting...*');
      expect(contents).toContain(
        '🔀 **Task delegated** to agent **Developer** (`DEVELOPER`) in project `my-app` — it is working on it now.',
      );
      expect(contents).toContain(
        '📋 **Response from agent Developer** (`DEVELOPER`) in project `my-app`:\nListed files.\n-# 🤖 Developer (agy) · 🧠 default · ⚡ default · ⏱️ 3.0s',
      );
      expect(contents).toContain(
        '↩️ **Developer finished** in project `my-app` — the CEO is reviewing the result.',
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
          if (typeof content === 'string' && content.includes('delegated')) {
            throw new Error('rate limited');
          }
          return { content, edit: vi.fn().mockResolvedValue(undefined) };
        });
        request.onDelegation?.({
          round: 1,
          role: 'DEVELOPER',
          roleName: 'Developer',
          phase: 'started',
        });
        request.onActivity?.({ kind: 'tool', toolCallId: 'c1', title: 'ls', status: 'completed' });
        return { sessionId: 'session-1', response: 'Done.', status: 'completed' };
      };

      await handler.handleMessage(message);
      await vi.runAllTimersAsync();

      expect(send).toHaveBeenLastCalledWith('Done.');
    });

    it('should send the CEO interim message before the delegation it precedes', async () => {
      const contents: string[] = [];
      const send = vi.fn().mockImplementation(async (content: string) => {
        contents.push(content);
        return { content, edit: vi.fn().mockResolvedValue(undefined) };
      });
      const message = {
        author: { bot: false, id: 'user-42' },
        channelId: 'channel-1',
        content: 'Hi',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: {
          id: 'thread-1',
          parentId: 'channel-1',
          ownerId: 'bot-123',
          isDMBased: vi.fn().mockReturnValue(false),
          isThread: vi.fn().mockReturnValue(true),
          send,
        },
      } as unknown as Message;
      orchestratorService.executeTurn = async (request: TurnRequest) => {
        request.onInterimMessage?.('Splitting this in two.');
        request.onDelegation?.({ round: 1, role: 'DEVELOPER', roleName: 'Developer', phase: 'started' });
        return { sessionId: 'session-1', response: 'Done.', status: 'completed' };
      };

      await handler.handleMessage(message);
      await vi.runAllTimersAsync();

      const interim = contents.indexOf('Splitting this in two.');
      expect(interim).toBeGreaterThanOrEqual(0);
      expect(interim).toBeLessThan(contents.findIndex(content => content.includes('Task delegated')));
    });

    it('should proceed gracefully when the CEO interim message cannot be sent', async () => {
      const send = vi.fn().mockImplementation(async (content: string) => {
        if (content === 'Splitting this in two.') {
          throw new Error('rate limited');
        }
        return { content, edit: vi.fn().mockResolvedValue(undefined) };
      });
      const message = {
        author: { bot: false, id: 'user-42' },
        channelId: 'channel-1',
        content: 'Hi',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: {
          id: 'thread-1',
          parentId: 'channel-1',
          ownerId: 'bot-123',
          isDMBased: vi.fn().mockReturnValue(false),
          isThread: vi.fn().mockReturnValue(true),
          send,
        },
      } as unknown as Message;
      orchestratorService.executeTurn = async (request: TurnRequest) => {
        request.onInterimMessage?.('Splitting this in two.');
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
          roleName: 'Developer',
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

      expect(sentMessages.some(m => typeof m.content === 'string' && m.content.includes('✅ **Completed**: `pwd`'))).toBe(true);
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

      const toolMsg = sentMessages.find(m => typeof m.content === 'string' && m.content.includes('Running'));
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.edit).toHaveBeenCalledWith('❌ **Failed**: `npm build`\n```\nexit code 1\n```');
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

  it('should abort subsequent chunks when an intermediate thought chunk send fails', async () => {
    const longLines = Array.from({ length: 90 }, (_, i) => `Thought line ${i + 1} with lots of details to extend length`);
    orchestratorService.activitiesToEmit = [{ kind: 'thought', id: 't1', text: longLines.join('\n') }];
    const sentChunks: string[] = [];
    let thoughtSendCalls = 0;

    const mockThread = {
      id: 'thread-1',
      parentId: 'channel-1',
      ownerId: 'bot-123',
      isDMBased: vi.fn().mockReturnValue(false),
      isThread: vi.fn().mockReturnValue(true),
      send: vi.fn().mockImplementation(async (content: string) => {
        if (content.startsWith('> 💭') || content.startsWith('> *')) {
          thoughtSendCalls++;
          if (thoughtSendCalls === 1) {
            sentChunks.push(content);
            return { content, edit: vi.fn().mockResolvedValue(undefined) };
          }
          if (thoughtSendCalls === 2) {
            throw new Error('Rate limit on chunk 2');
          }
          sentChunks.push(content);
          return { content, edit: vi.fn().mockResolvedValue(undefined) };
        }
        return { delete: vi.fn().mockResolvedValue(undefined) };
      }),
    } as unknown as ThreadChannel;

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Split failure',
      content: 'Split failure',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: mockThread,
    } as unknown as Message;

    await handler.handleMessage(message);
    await vi.runAllTimersAsync();

    expect(sentChunks).toHaveLength(1);
    expect(thoughtSendCalls).toBe(2);
  });

  it('should clean up in-flight thought message if activity was removed during send', async () => {
    let resolveSend!: (msg: unknown) => void;
    const sendDeferred = new Promise((resolve) => {
      resolveSend = resolve;
    });

    const mockDeletedMsg = {
      content: 'thinking slow',
      edit: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    let sendCalls = 0;
    const mockThread = {
      id: 'thread-1',
      parentId: 'channel-1',
      ownerId: 'bot-123',
      isDMBased: vi.fn().mockReturnValue(false),
      isThread: vi.fn().mockReturnValue(true),
      send: vi.fn().mockImplementation(async () => {
        sendCalls++;
        if (sendCalls === 1) {
          return { delete: vi.fn().mockResolvedValue(undefined) };
        }
        return sendDeferred;
      }),
    } as unknown as ThreadChannel;

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Race condition',
      content: 'Race condition',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: mockThread,
    } as unknown as Message;

    vi.spyOn(orchestratorService, 'executeTurn').mockImplementation(async (req) => {
      req.onActivity?.({ kind: 'thought', id: 't1', text: 'thinking slow' });
      await vi.advanceTimersByTimeAsync(1500);
      req.onActivity?.({ kind: 'thought', id: 't1', text: 'thinking slow', removed: true });
      resolveSend(mockDeletedMsg);
      await sendDeferred;
      return orchestratorService.mockResult;
    });

    await handler.handleMessage(message);
    await vi.runAllTimersAsync();

    expect(mockDeletedMsg.delete).toHaveBeenCalled();
  });

  it('should ignore deleted trackers and handle null sent message in syncThoughtMessages', async () => {
    const deletedTracker = {
      messages: [],
      currentText: 'Deleted text',
      isDeleted: true,
    };
    const nullSendTracker = {
      messages: [],
      currentText: 'Null send text',
    };
    const trackers = new Map([
      ['del', deletedTracker],
      ['nullSend', nullSendTracker],
    ]);
    const mockChannel = {
      send: vi.fn().mockResolvedValue(null),
    };

    await (handler as any).syncThoughtMessages(trackers, mockChannel);

    expect(mockChannel.send).toHaveBeenCalledTimes(1);
    expect(nullSendTracker.messages).toHaveLength(0);
  });

  it('should handle in-flight removed thought when sent message has no delete method', async () => {
    const tracker: any = {
      messages: [],
      currentText: 'No delete method text',
      isDeleted: false,
    };
    const trackers = new Map([['t1', tracker]]);
    const mockMsgWithoutDelete = { content: 'test', edit: vi.fn() };
    const mockChannel = {
      send: vi.fn().mockImplementation(async () => {
        tracker.isDeleted = true;
        return mockMsgWithoutDelete;
      }),
    };

    await (handler as any).syncThoughtMessages(trackers, mockChannel);

    expect(tracker.messages).toHaveLength(0);
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

  it('should show local file links in the response as plain text', async () => {
    const progressMessage = { edit: vi.fn().mockResolvedValue(undefined) };
    const mockThread = {
      id: 'thread-999',
      send: vi.fn().mockResolvedValue(progressMessage),
    };

    orchestratorService.mockResult = {
      sessionId: 'session-1',
      response: 'Em [`src/Header.js`](file:///home/u/repo/src/Header.js#L51-L54):',
      status: 'completed',
    };

    const message = {
      author: { bot: false, id: 'user-42' },
      channelId: 'channel-1',
      cleanContent: 'Plan',
      content: '<@bot-123> Plan',
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: { isDMBased: vi.fn().mockReturnValue(false), isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    await handler.handleMessage(message);

    expect(mockThread.send).toHaveBeenCalledWith('Em `src/Header.js`:');
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
      '✅ *Task completed with no response message.*',
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
      '⚠️ **Turn cancelled by the user.**',
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
      '❌ **Execution error**: Workspace not found',
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
      '❌ **An error occurred while processing your request:** Discord API 500',
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
      '❌ **An error occurred while processing your request:** raw string error',
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
      conversationId: 'dm-channel-1',
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
      'Hi! How can I help you today? Please send an instruction or task.',
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
      '❌ **An error occurred while processing your request:** Internal failure',
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
      expect(sent[0]!.startsWith('❌ **Execution error**: stderr line')).toBe(true);
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
      expect(sent[0]!.startsWith('❌ **An error occurred while processing your request:** trace line')).toBe(true);
      expect(sent.every(text => text.length <= 2000)).toBe(true);
    });

    it.each([
      ['completed without text', { response: '', status: 'completed' }, '✅ *Task completed with no response message.*'],
      ['cancelled', { response: '', status: 'cancelled' }, '⚠️ **Turn cancelled by the user.**'],
      ['failed', { response: '', status: 'failed', errorMessage: 'boom' }, '❌ **Execution error**: boom'],
    ] as const)('should append the footer when the turn is %s', async (_label, partial, text) => {
      const send = vi.fn().mockResolvedValue({ edit: vi.fn().mockResolvedValue(undefined) });
      orchestratorService.mockResult = { sessionId: 'session-1', ...partial, agentInfo };

      await handler.handleMessage(threadMessage(send));

      expect(send).toHaveBeenLastCalledWith(`${text}\n${footer}`);
    });

    it('should send only the steering notice without footer when the message joined a running turn', async () => {
      const send = vi.fn().mockResolvedValue({ edit: vi.fn().mockResolvedValue(undefined) });
      orchestratorService.mockResult = {
        sessionId: 'session-1',
        response: '',
        status: 'steered',
        agentInfo,
      };

      await handler.handleMessage(threadMessage(send));

      expect(send).toHaveBeenLastCalledWith(
        '📨 *Message sent to the running agent. The reply will come with the current task\'s response.*',
      );
      const sent = send.mock.calls.map(call => call[0] as string);
      expect(sent.some(text => text.includes(footer))).toBe(false);
    });
  });

  describe('agent configuration selection', () => {
    const selection = {
      conversationId: 'channel-1:thread-1',
      step: 'model' as const,
      options: [{ index: 1, id: 'm1', label: 'Model 1' }],
    };
    const settings = {
      profiles: {
        CEO: {
          agentId: 'claude',
          agentName: 'Claude Code',
          modelId: 'm1',
          modelName: 'Model 1',
          effortId: null,
          effortName: null,
        },
      },
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

      expect(orchestratorService.resolvedInputs).toEqual([{ conversationId: 'channel-1:thread-1', prompt: 'Build it' }]);
      expect(send).toHaveBeenCalledWith(expect.stringContaining('**1.** Model 1'));
      expect(orchestratorService.lastRequest).toBeUndefined();
    });

    it('should repeat the options on an invalid answer', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      orchestratorService.resolution = { kind: 'invalid', selection };

      await handler.handleMessage(threadMessage(send, 'abc'));

      expect(send).toHaveBeenCalledWith(expect.stringMatching(/^⚠️ Invalid option/));
      expect(orchestratorService.lastRequest).toBeUndefined();
    });

    it('should confirm a configuration without pending prompt', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      orchestratorService.resolution = { kind: 'configured', settings };

      await handler.handleMessage(threadMessage(send));

      expect(send).toHaveBeenCalledWith('✅ **Settings saved**: 🤖 Claude Code · 🧠 Model 1 · ⚡ default');
      expect(orchestratorService.lastRequest).toBeUndefined();
    });

    it('should confirm the configuration and run the pending prompt', async () => {
      const send = vi.fn().mockResolvedValue({ edit: vi.fn().mockResolvedValue(undefined) });
      orchestratorService.resolution = { kind: 'execute', prompt: 'Build it', configured: settings };

      await handler.handleMessage(threadMessage(send));

      expect(send.mock.calls[0]![0]).toBe('✅ **Settings saved**: 🤖 Claude Code · 🧠 Model 1 · ⚡ default');
      expect(orchestratorService.lastRequest?.prompt).toBe('Build it');
    });

    const profilesSelection = {
      conversationId: 'channel-1:thread-1',
      step: 'profile' as const,
      options: [{ index: 1, id: 'CEO', label: 'CEO', description: 'Claude Code - default - default' }],
    };

    it('should post the profile list on profiles_menu', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      orchestratorService.resolution = { kind: 'profiles_menu', selection: profilesSelection };

      await handler.handleMessage(threadMessage(send, '0'));

      expect(send).toHaveBeenCalledWith(expect.stringContaining('**1.** CEO — Claude Code - default - default'));
      expect(orchestratorService.lastRequest).toBeUndefined();
    });

    it('should confirm the update and show the refreshed list on profiles_updated', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      orchestratorService.resolution = {
        kind: 'profiles_updated',
        selection: profilesSelection,
        updatedRoles: [{ id: 'CEO', name: 'CEO' }],
        profile: settings.profiles.CEO!,
      };

      await handler.handleMessage(threadMessage(send));

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(
        '✅ **Profiles updated** (CEO): 🤖 Claude Code · 🧠 Model 1 · ⚡ default\n\n'
        + '👥 **Choose the profiles to configure** — type numbers separated by commas, or 0 to exit:\n'
        + '**1.** CEO — Claude Code - default - default',
      );
    });

    it('should split a long profiles_updated message into several messages', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      orchestratorService.resolution = {
        kind: 'profiles_updated',
        selection: {
          ...profilesSelection,
          options: Array.from({ length: 60 }, (_, i) => ({
            index: i + 1,
            id: `R${i}`,
            label: `Role ${i}`,
            description: 'x'.repeat(50),
          })),
        },
        updatedRoles: [{ id: 'CEO', name: 'CEO' }],
        profile: settings.profiles.CEO!,
      };

      await handler.handleMessage(threadMessage(send));

      expect(send.mock.calls.length).toBeGreaterThan(1);
      for (const [chunk] of send.mock.calls) {
        expect((chunk as string).length).toBeLessThanOrEqual(2000);
      }
    });

    it('should announce that the profile configuration closed on profiles_closed', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      orchestratorService.resolution = { kind: 'profiles_closed' };

      await handler.handleMessage(threadMessage(send, '0'));

      expect(send).toHaveBeenCalledWith('✅ **Profile configuration closed.**');
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

      expect(orchestratorService.selectionLookups).toEqual(['channel-1:thread-9']);
      expect(orchestratorService.resolvedInputs).toEqual([{ conversationId: 'channel-1:thread-9', prompt: '1' }]);
      expect(send).toHaveBeenCalledWith('✅ **Settings saved**: 🤖 Claude Code · 🧠 Model 1 · ⚡ default');
    });

    it('should take a message without mention as the language while a language change is pending', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      orchestratorService.pendingLanguageChange = true;
      orchestratorService.resolution = { kind: 'language_set', language: 'Spanish' };

      await handler.handleMessage(unmanagedThreadMessage(send));

      expect(orchestratorService.lastRequest).toBeUndefined();
      expect(send).toHaveBeenCalledWith('✅ **Language saved**: Spanish');
    });

    it('should ask again when the language is invalid', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      orchestratorService.pendingLanguageChange = true;
      orchestratorService.resolution = { kind: 'invalid_language' };

      await handler.handleMessage(unmanagedThreadMessage(send));

      expect(send).toHaveBeenCalledWith('⚠️ Invalid language. Reply with just the language name, up to 64 characters, such as "Spanish".');
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

  describe('questions to the user', () => {
    const prompt: QuestionPrompt = {
      asker: { role: 'PRODUCT_OWNER', roleName: 'Product Owner Agent', projectName: null },
      question: { text: 'Who approves?', options: ['Manager', 'Finance'] },
      number: 1,
      total: 2,
      waitingAskers: 0,
    };

    const threadMessage = (send: ReturnType<typeof vi.fn>, content: string, ownerId = 'bot-123') => ({
      author: { bot: false, id: 'user-42' },
      channelId: 'thread-1',
      content,
      mentions: { has: vi.fn().mockReturnValue(false) },
      attachments: new Map(),
      channel: {
        id: 'thread-1',
        parentId: 'channel-1',
        ownerId,
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(true),
        send,
      },
    }) as unknown as Message;

    it('should show the next question instead of running a turn', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      orchestratorService.resolution = { kind: 'question', prompt };

      await handler.handleMessage(threadMessage(send, '2'));

      expect(send).toHaveBeenCalledWith(expect.stringContaining('❓ **Question 1/2** · Product Owner Agent'));
      expect(orchestratorService.lastRequest).toBeUndefined();
    });

    it('should repeat the question on an invalid option', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      orchestratorService.resolution = { kind: 'invalid_answer', prompt };

      await handler.handleMessage(threadMessage(send, '9'));

      expect(send).toHaveBeenCalledWith(expect.stringMatching(/^⚠️ Invalid option/));
    });

    it('should confirm the answers and show the question of the next waiting agent', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      const next = { ...prompt, asker: { role: 'TECH_LEAD', roleName: 'Tech Lead Agent', projectName: 'my-app' } };
      orchestratorService.resolution = { kind: 'answered', asker: prompt.asker, next };

      await handler.handleMessage(threadMessage(send, 'Finance'));

      expect(send.mock.calls.map(([content]) => content)).toEqual([
        '✅ Answers sent to **Product Owner Agent**.',
        expect.stringContaining('· Tech Lead Agent (`my-app`)'),
      ]);
    });

    it('should only confirm the answers when no other agent is waiting', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      orchestratorService.resolution = { kind: 'answered', asker: prompt.asker };

      await handler.handleMessage(threadMessage(send, 'Finance'));

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith('✅ Answers sent to **Product Owner Agent**.');
    });

    it('should hand the downloaded attachments to the input resolution', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      orchestratorService.resolution = { kind: 'answered', asker: prompt.asker };
      const message = threadMessage(send, 'see file');
      (message as unknown as { attachments: Map<string, unknown> }).attachments = new Map([['a', { name: 'a.png' }]]);

      await handler.handleMessage(message);

      expect(orchestratorService.resolvedInputs).toEqual([
        {
          conversationId: 'channel-1:thread-1',
          prompt: 'see file',
          attachments: attachmentService.downloadedAttachments,
        },
      ]);
    });

    it('should accept an answer without mention in an unmanaged thread with questions waiting', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      orchestratorService.pendingQuestions = true;
      orchestratorService.resolution = { kind: 'question', prompt };

      await handler.handleMessage(threadMessage(send, '1', 'someone-else'));

      expect(orchestratorService.selectionLookups).toEqual([]);
      expect(orchestratorService.resolvedInputs).toEqual([{ conversationId: 'channel-1:thread-1', prompt: '1' }]);
    });

    it('should show the question an agent asks during the turn, in order with the delegation notices', async () => {
      const contents: string[] = [];
      const send = vi.fn().mockImplementation(async (content: string) => {
        contents.push(content);
        return { content, edit: vi.fn().mockResolvedValue(undefined) };
      });
      orchestratorService.executeTurn = async (request: TurnRequest) => {
        request.onDelegation?.({ round: 1, role: 'PRODUCT_OWNER', roleName: 'Product Owner Agent', phase: 'started' });
        request.onQuestion?.(prompt);
        return { sessionId: 'session-1', response: 'Done.', status: 'completed' };
      };

      await handler.handleMessage(threadMessage(send, 'Plan refunds'));
      await vi.runAllTimersAsync();

      const delegated = contents.findIndex(content => content.includes('Task delegated'));
      const question = contents.findIndex(content => content.includes('❓ **Question 1/2**'));
      expect(delegated).toBeGreaterThanOrEqual(0);
      expect(question).toBeGreaterThan(delegated);
    });

    it('should proceed gracefully when the question cannot be sent', async () => {
      const send = vi.fn().mockImplementation(async (content: string) => {
        if (content.includes('❓')) {
          throw new Error('rate limited');
        }
        return { content, edit: vi.fn().mockResolvedValue(undefined) };
      });
      orchestratorService.executeTurn = async (request: TurnRequest) => {
        request.onQuestion?.(prompt);
        return { sessionId: 'session-1', response: 'Done.', status: 'completed' };
      };

      await handler.handleMessage(threadMessage(send, 'Plan refunds'));
      await vi.runAllTimersAsync();

      expect(send).toHaveBeenLastCalledWith('Done.');
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

      expect(typingCallsDuringTurn).toBe(2);
      const callsAfterTurn = sendTyping.mock.calls.length;

      vi.advanceTimersByTime(20000);
      expect(sendTyping).toHaveBeenCalledTimes(callsAfterTurn);
    });

    it('should show typing while the input is resolved and stop after answering a selection', async () => {
      const sendTyping = vi.fn().mockResolvedValue(undefined);
      let typingCallsDuringResolution = 0;
      const mockThread = {
        id: 'thread-1',
        parentId: 'channel-1',
        ownerId: 'bot-123',
        isDMBased: vi.fn().mockReturnValue(false),
        isThread: vi.fn().mockReturnValue(true),
        send: vi.fn().mockResolvedValue(undefined),
        sendTyping,
      } as unknown as ThreadChannel;
      const message = {
        author: { bot: false, id: 'user-42' },
        channelId: 'channel-1',
        cleanContent: '2',
        content: '2',
        mentions: { has: vi.fn().mockReturnValue(false) },
        channel: mockThread,
      } as unknown as Message;
      orchestratorService.resolveInput = async () => {
        typingCallsDuringResolution = sendTyping.mock.calls.length;
        return {
          kind: 'selection',
          selection: { conversationId: 'channel-1:thread-1', step: 'agent', options: [] },
        };
      };

      await handler.handleMessage(message);

      expect(typingCallsDuringResolution).toBe(1);
      vi.advanceTimersByTime(20000);
      expect(sendTyping).toHaveBeenCalledTimes(1);
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
          roleName: 'Developer',
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

    it('should resolve a message with only attachments and run the prompt the resolution returns', async () => {
      const { message, mockThread } = createThreadMessageWithAttachments('', [createAttachment('diagram.png')]);
      orchestratorService.resolution = { kind: 'execute', prompt: 'The user sent attachments. Analyze the attached files.' };

      await handler.handleMessage(message);

      expect(orchestratorService.resolvedInputs).toEqual([
        {
          conversationId: 'channel-1:thread-att-1',
          prompt: '',
          attachments: [expect.objectContaining({ name: 'diagram.png' })],
        },
      ]);

      expect(attachmentService.validateAttachments).toHaveBeenCalledWith([expect.objectContaining({ name: 'diagram.png' })]);
      expect(attachmentService.downloadAttachments).toHaveBeenCalledWith(
        'channel-1:thread-att-1',
        [expect.objectContaining({ name: 'diagram.png' })],
      );
      expect(orchestratorService.lastRequest).toMatchObject({
        conversationId: 'channel-1:thread-att-1',
        prompt: 'The user sent attachments. Analyze the attached files.',
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
        conversationId: 'channel-1:thread-att-1',
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
        reason: '⚠️ The file "virus.exe" has an unsupported format or is incompatible with the agent\'s tools.',
      };

      const { message, mockThread } = createThreadMessageWithAttachments('', [createAttachment('virus.exe', 'application/x-msdownload')]);

      await handler.handleMessage(message);

      expect(mockThread.send).toHaveBeenCalledWith(
        '⚠️ The file "virus.exe" has an unsupported format or is incompatible with the agent\'s tools.',
      );
      expect(orchestratorService.lastRequest).toBeUndefined();
    });

    it('should report error to channel when attachment download fails', async () => {
      attachmentService.downloadError = new Error('Discord CDN download failed');

      const { message, mockThread } = createThreadMessageWithAttachments('See attachment', [createAttachment('broken.png')]);

      await handler.handleMessage(message);

      expect(mockThread.send).toHaveBeenCalledWith(
        '❌ **An error occurred while processing your request:** Discord CDN download failed',
      );
      expect(orchestratorService.lastRequest).toBeUndefined();
    });

    it('should send greeting when prompt is empty and attachments map is empty', async () => {
      const { message, mockThread } = createThreadMessageWithAttachments('', []);

      await handler.handleMessage(message);

      expect(mockThread.send).toHaveBeenCalledWith(
        'Hi! How can I help you today? Please send an instruction or task.',
      );
      expect(orchestratorService.lastRequest).toBeUndefined();
    });
  });
});
