import { Test, type TestingModule } from '@nestjs/testing';
import type { ChatInputCommandInteraction, Message } from 'discord.js';
import { Events } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import type {
  AgentActivity,
  AgentUsage,
  IAgentPort,
} from '../src/modules/agent/ports/agent.port.js';
import { IAgentPort as IAgentPortSymbol } from '../src/modules/agent/ports/agent.port.js';
import { DiscordMessageHandler } from '../src/modules/discord/handlers/discord-message.handler.js';
import { DiscordClientService } from '../src/modules/discord/services/discord-client.service.js';
import { ISessionStorePort } from '../src/modules/orchestrator/ports/session-store.port.js';


class E2EAgentFake implements Partial<IAgentPort> {
  lastAgentMessage = 'Implementation completed successfully.';
  currentSessionId?: string;

  async connect(): Promise<void> {
    return undefined;
  }

  async createSession(): Promise<void> {
    this.currentSessionId = 'e2e-session-123';
  }

  async getLastRoundUsage(): Promise<AgentUsage> {
    return {
      totalTokens: 150,
      inputTokens: 100,
      outputTokens: 50,
    };
  }

  async* prompt(): AsyncGenerator<any> {
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

describe('Discord Bot Driving Adapter (e2e)', () => {
  it('should process user message, emit activities, and post final response to thread', async () => {
    const fakeAgent = new E2EAgentFake();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IAgentPortSymbol)
      .useValue(fakeAgent)
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
    expect(storedSession?.agentId).toBe('CEO');

    await app.close();
  });

  it('should handle /cancel slash command and trigger orchestrator cancellation', async () => {
    const fakeAgent = new E2EAgentFake();
    const cancelSpy = vi.spyOn(fakeAgent, 'cancel');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IAgentPortSymbol)
      .useValue(fakeAgent)
      .compile();

    const app = moduleFixture.createNestApplication();
    await app.init();

    const discordClientService =
      moduleFixture.get<DiscordClientService>(DiscordClientService);
    const sessionStore =
      moduleFixture.get<ISessionStorePort>(ISessionStorePort);

    await sessionStore.saveSession({
      sessionId: 'session-cancel-e2e',
      channelId: 'channel-main',
      threadId: 'thread-sub',
      userId: 'user-1',
      workspacePath: process.cwd(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const client = discordClientService.getClient();

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

    await vi.waitFor(() => {
      expect(replyMock).toHaveBeenCalledWith({
        content:
          '🛑 **Cancelamento solicitado.** O turno ativo será interrompido.',
        ephemeral: true,
      });
      expect(cancelSpy).toHaveBeenCalled();
    });

    await app.close();
  });
});
