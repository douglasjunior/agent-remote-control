import { Test, type TestingModule } from '@nestjs/testing';
import type { ChatInputCommandInteraction, Message } from 'discord.js';
import { Events } from 'discord.js';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { IAgentPortFactory } from '../src/modules/agent/ports/agent-port-factory.port.js';
import {
  type AgentActivity,
  type AgentUsage,
  type IAgentPort,
  PromptCancelledError,
} from '../src/modules/agent/ports/agent.port.js';
import { DiscordMessageHandler } from '../src/modules/discord/handlers/discord-message.handler.js';
import { DiscordClientService } from '../src/modules/discord/services/discord-client.service.js';
import { ISessionStorePort } from '../src/modules/orchestrator/ports/session-store.port.js';


class E2EAgentFake implements Partial<IAgentPort> {
  lastAgentMessage = 'Implementation completed successfully.';
  currentSessionId?: string;
  readonly sessionCwds: string[] = [];
  readonly prompts: string[] = [];

  async connect(): Promise<void> {
    return undefined;
  }

  async createSession(cwd: string): Promise<void> {
    this.sessionCwds.push(cwd);
    this.currentSessionId = 'e2e-session-123';
  }

  async getLastRoundUsage(): Promise<AgentUsage> {
    return {
      totalTokens: 150,
      inputTokens: 100,
      outputTokens: 50,
    };
  }

  async* prompt(text: string): AsyncGenerator<any> {
    this.prompts.push(text);
    yield {
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: 'Implementation completed successfully.',
        },
      },
    };
  }

  onActivity(listener: (activity: AgentActivity) => void): () => void {
    listener({
      kind: 'thought',
      id: 'thought-e2e-1',
      text: 'Analyzing user request in Discord thread...',
    });
    listener({
      kind: 'tool',
      toolCallId: 'tool-call-1',
      title: 'git status',
      status: 'in_progress',
    });
    listener({
      kind: 'tool',
      toolCallId: 'tool-call-1',
      title: 'git status',
      status: 'completed',
    });
    return () => undefined;
  }

  async cancel(): Promise<void> {
    return undefined;
  }

  async closeSession(): Promise<void> {
    return undefined;
  }

  async disconnect(): Promise<void> {
    return undefined;
  }

  getAvailableModels() {
    return null;
  }

  async getAvailableEffortsForModel() {
    return null;
  }

  async setConfig(): Promise<void> {
    return undefined;
  }
}

class ScriptedAgentFake extends E2EAgentFake {
  constructor(private readonly responses: string[]) {
    super();
  }

  override async* prompt(text: string): AsyncGenerator<any> {
    this.prompts.push(text);
    this.lastAgentMessage = this.responses.shift() ?? '';
    yield {
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: this.lastAgentMessage },
      },
    };
  }
}

class BlockingAgentFake extends E2EAgentFake {
  private rejectPrompt: ((error: Error) => void) | null = null;
  readonly promptStarted: Promise<void>;
  private markStarted: () => void = () => undefined;

  constructor() {
    super();
    this.promptStarted = new Promise((resolve) => {
      this.markStarted = resolve;
    });
  }

  override async* prompt(text: string): AsyncGenerator<any> {
    this.prompts.push(text);
    this.lastAgentMessage = '';
    await new Promise<void>((_resolve, reject) => {
      this.rejectPrompt = reject;
      this.markStarted();
    });
    yield undefined;
  }

  override async cancel(): Promise<void> {
    this.rejectPrompt?.(new PromptCancelledError());
  }
}

describe('Discord Bot Driving Adapter (e2e)', () => {
  let workspaceDir: string;
  const originalWorkspaceDir = process.env.WORKSPACE_DIR;

  beforeAll(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'arc-e2e-workspaces-'));
    process.env.WORKSPACE_DIR = workspaceDir;
  });

  afterAll(() => {
    if (originalWorkspaceDir === undefined) {
      delete process.env.WORKSPACE_DIR;
    } else {
      process.env.WORKSPACE_DIR = originalWorkspaceDir;
    }
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('should process user message, emit activities, and post final response to thread', async () => {
    const fakeAgent = new E2EAgentFake();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IAgentPortFactory)
      .useValue({ create: () => fakeAgent })
      .compile();

    const app = moduleFixture.createNestApplication();
    await app.init();

    const discordClientService =
      moduleFixture.get<DiscordClientService>(DiscordClientService);
    const messageHandler = moduleFixture.get<DiscordMessageHandler>(
      DiscordMessageHandler,
    );
    const sessionStore =
      moduleFixture.get<ISessionStorePort>(ISessionStorePort);

    const client = discordClientService.getClient();
    const botUser = { id: 'bot-e2e-id', username: 'RemoteControlBot' };
    (client as any).user = botUser;

    const editMock = vi.fn().mockResolvedValue(undefined);
    const progressMessage = {
      edit: editMock,
    };
    const threadMessages: string[] = [];
    const mockThread = {
      id: 'thread-e2e-999',
      parentId: 'channel-e2e-111',
      send: vi.fn().mockImplementation(async (content: string) => {
        threadMessages.push(content);
        return progressMessage;
      }),
    };

    const startThreadMock = vi.fn().mockResolvedValue(mockThread);
    const incomingMessage = {
      author: { bot: false, id: 'discord-user-777' },
      channelId: 'channel-e2e-111',
      cleanContent: 'Please implement git ability in CEO persona',
      content: '<@!bot-e2e-id> Please implement git ability in CEO persona',
      mentions: {
        has: vi
          .fn()
          .mockImplementation((user: any) => user?.id === 'bot-e2e-id'),
      },
      channel: {
        isThread: vi.fn().mockReturnValue(false),
      },
      startThread: startThreadMock,
    } as unknown as Message;

    await messageHandler.handleMessage(incomingMessage);

    expect(startThreadMock).toHaveBeenCalledWith({
      name: 'Please implement git ability in CEO persona',
      autoArchiveDuration: 60,
    });

    expect(threadMessages).toContain('⏳ *Iniciando processamento...*');
    expect(threadMessages).toContain('Implementation completed successfully.');

    expect(editMock).toHaveBeenCalled();

    const storedSession = await sessionStore.findSession(
      'channel-e2e-111',
      'thread-e2e-999',
    );
    expect(storedSession).not.toBeNull();
    expect(storedSession?.userId).toBe('discord-user-777');
    expect(storedSession?.agentRole).toBe('CEO');

    await app.close();
  });

  it('should cancel a turn in progress through the /cancel slash command', async () => {
    const fakeAgent = new BlockingAgentFake();
    const cancelSpy = vi.spyOn(fakeAgent, 'cancel');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IAgentPortFactory)
      .useValue({ create: () => fakeAgent })
      .compile();

    const app = moduleFixture.createNestApplication();
    await app.init();

    const discordClientService =
      moduleFixture.get<DiscordClientService>(DiscordClientService);
    const messageHandler = moduleFixture.get<DiscordMessageHandler>(
      DiscordMessageHandler,
    );
    const client = discordClientService.getClient();
    (client as any).user = { id: 'bot-e2e-id' };

    const threadMessages: string[] = [];
    const thread = {
      id: 'thread-sub',
      parentId: 'channel-main',
      ownerId: 'bot-e2e-id',
      isThread: vi.fn().mockReturnValue(true),
      send: vi.fn().mockImplementation(async (content: string) => {
        threadMessages.push(content);
        return { edit: vi.fn().mockResolvedValue(undefined) };
      }),
    };
    const incomingMessage = {
      author: { bot: false, id: 'discord-user-777' },
      channelId: 'thread-sub',
      cleanContent: 'Long task',
      content: 'Long task',
      mentions: { has: vi.fn().mockReturnValue(false) },
      channel: thread,
    } as unknown as Message;

    const handling = messageHandler.handleMessage(incomingMessage);
    await fakeAgent.promptStarted;

    const replyMock = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      isChatInputCommand: vi.fn().mockReturnValue(true),
      commandName: 'cancel',
      channelId: 'thread-sub',
      channel: {
        isThread: vi.fn().mockReturnValue(true),
        parentId: 'channel-main',
      },
      deferred: false,
      replied: false,
      reply: replyMock,
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;

    client.emit(Events.InteractionCreate, interaction);
    await handling;

    expect(cancelSpy).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(replyMock).toHaveBeenCalledWith({
        content:
          '🛑 **Cancelamento solicitado.** O turno ativo será interrompido.',
        ephemeral: true,
      });
    });
    expect(threadMessages).toContain('⚠️ **Turno cancelado pelo usuário.**');

    await app.close();
  });

  it('should delegate from CEO to Developer inside the project workspace and report the final summary', async () => {
    const ceo = new ScriptedAgentFake([
      'Implement the login screen.\n[DELEGATE:DEVELOPER:my-app]',
      'Login delivered.\n[DONE]',
    ]);
    const developer = new ScriptedAgentFake(['Login screen implemented.']);
    const agents = [ceo, developer];

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IAgentPortFactory)
      .useValue({ create: () => agents.shift() })
      .compile();

    const app = moduleFixture.createNestApplication();
    await app.init();

    const discordClientService =
      moduleFixture.get<DiscordClientService>(DiscordClientService);
    const messageHandler = moduleFixture.get<DiscordMessageHandler>(
      DiscordMessageHandler,
    );
    (discordClientService.getClient() as any).user = { id: 'bot-e2e-id' };

    const threadMessages: string[] = [];
    const mockThread = {
      id: 'thread-delegation',
      parentId: 'channel-delegation',
      send: vi.fn().mockImplementation(async (content: string) => {
        threadMessages.push(content);
        return { edit: vi.fn().mockResolvedValue(undefined) };
      }),
    };
    const incomingMessage = {
      author: { bot: false, id: 'discord-user-777' },
      channelId: 'channel-delegation',
      cleanContent: 'Add login to my-app',
      content: '<@bot-e2e-id> Add login to my-app',
      mentions: {
        has: vi.fn().mockImplementation((user: any) => user?.id === 'bot-e2e-id'),
      },
      channel: { isThread: vi.fn().mockReturnValue(false) },
      startThread: vi.fn().mockResolvedValue(mockThread),
    } as unknown as Message;

    await messageHandler.handleMessage(incomingMessage);

    expect(ceo.sessionCwds).toEqual([workspaceDir]);
    expect(developer.sessionCwds).toEqual([join(workspaceDir, 'my-app')]);
    expect(existsSync(join(workspaceDir, 'my-app'))).toBe(true);
    expect(developer.prompts[0]).toContain('Developer Agent');
    expect(developer.prompts[0]).toContain('Implement the login screen.');
    expect(ceo.prompts[1]).toBe(
      '[AGENT_RESULT:DEVELOPER]\nLogin screen implemented.',
    );
    expect(threadMessages).toContain('Login delivered.');

    await app.close();
  });
});
