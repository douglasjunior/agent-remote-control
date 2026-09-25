import type {
  ChatInputCommandInteraction,
  Client,
  Interaction,
} from 'discord.js';
import { Events } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrchestratorService } from '../../orchestrator/services/orchestrator.service.js';
import { DiscordClientService } from '../services/discord-client.service.js';

import { DiscordInteractionHandler } from './discord-interaction.handler.js';


class StubOrchestratorService implements Partial<OrchestratorService> {
  cancelledChannelId?: string;
  cancelledThreadId?: string;
  throwError = false;

  async cancelTurn(channelId: string, threadId?: string): Promise<void> {
    if (this.throwError) {
      throw new Error('Cancel turn failed');
    }
    this.cancelledChannelId = channelId;
    this.cancelledThreadId = threadId;
  }
}

describe('DiscordInteractionHandler', () => {
  let mockClient: Client;
  let clientService: DiscordClientService;
  let orchestratorService: StubOrchestratorService;
  let handler: DiscordInteractionHandler;

  beforeEach(() => {
    mockClient = {
      on: vi.fn(),
    } as unknown as Client;

    clientService = new DiscordClientService(mockClient);
    orchestratorService = new StubOrchestratorService();
    handler = new DiscordInteractionHandler(
      clientService,
      orchestratorService as unknown as OrchestratorService,
    );
  });

  it('should register interactionCreate listener on onModuleInit and invoke callback', () => {
    let interactionListener: ((interaction: Interaction) => void) | undefined;
    vi.mocked(mockClient.on).mockImplementation(((event: string, cb: any) => {
      if (event === Events.InteractionCreate) {
        interactionListener = cb;
      }
      return mockClient;
    }) as any);

    handler.onModuleInit();
    expect(interactionListener).toBeDefined();

    const nonChatInput = {
      isChatInputCommand: vi.fn().mockReturnValue(false),
    } as unknown as Interaction;
    interactionListener?.(nonChatInput);
  });

  it('should ignore interactions that are not chat input commands', async () => {
    const interaction = {
      isChatInputCommand: vi.fn().mockReturnValue(false),
    } as unknown as Interaction;

    await handler.handleInteraction(interaction);

    expect(orchestratorService.cancelledChannelId).toBeUndefined();
  });

  it('should ignore chat input commands other than cancel', async () => {
    const interaction = {
      isChatInputCommand: vi.fn().mockReturnValue(true),
      commandName: 'help',
    } as unknown as Interaction;

    await handler.handleInteraction(interaction);

    expect(orchestratorService.cancelledChannelId).toBeUndefined();
  });

  it('should execute /cancel in standard channel and reply with ephemeral confirmation', async () => {
    const interaction = {
      isChatInputCommand: vi.fn().mockReturnValue(true),
      commandName: 'cancel',
      channelId: 'channel-123',
      channel: { isThread: vi.fn().mockReturnValue(false) },
      deferred: false,
      replied: false,
      reply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;

    await handler.handleInteraction(interaction);

    expect(orchestratorService.cancelledChannelId).toBe('channel-123');
    expect(orchestratorService.cancelledThreadId).toBeUndefined();
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        '🛑 **Cancelamento solicitado.** O turno ativo será interrompido.',
      ephemeral: true,
    });
  });

  it('should execute /cancel in a thread channel using parentId as channelId', async () => {
    const interaction = {
      isChatInputCommand: vi.fn().mockReturnValue(true),
      commandName: 'cancel',
      channelId: 'thread-777',
      channel: {
        isThread: vi.fn().mockReturnValue(true),
        parentId: 'parent-channel-456',
      },
      deferred: false,
      replied: false,
      reply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;

    await handler.handleInteraction(interaction);

    expect(orchestratorService.cancelledChannelId).toBe('parent-channel-456');
    expect(orchestratorService.cancelledThreadId).toBe('thread-777');
  });

  it('should fallback to channelId if parentId is not present on thread', async () => {
    const interaction = {
      isChatInputCommand: vi.fn().mockReturnValue(true),
      commandName: 'cancel',
      channelId: 'thread-777',
      channel: {
        isThread: vi.fn().mockReturnValue(true),
        parentId: undefined,
      },
      deferred: false,
      replied: false,
      reply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;

    await handler.handleInteraction(interaction);

    expect(orchestratorService.cancelledChannelId).toBe('thread-777');
    expect(orchestratorService.cancelledThreadId).toBe('thread-777');
  });

  it('should use followUp if interaction is already deferred or replied', async () => {
    const interaction = {
      isChatInputCommand: vi.fn().mockReturnValue(true),
      commandName: 'cancel',
      channelId: 'channel-123',
      channel: { isThread: vi.fn().mockReturnValue(false) },
      deferred: true,
      replied: false,
      reply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;

    await handler.handleInteraction(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith({
      content:
        '🛑 **Cancelamento solicitado.** O turno ativo será interrompido.',
      ephemeral: true,
    });
  });

  it('should handle cancel error and reply with error message', async () => {
    orchestratorService.throwError = true;
    const interaction = {
      isChatInputCommand: vi.fn().mockReturnValue(true),
      commandName: 'cancel',
      channelId: 'channel-123',
      channel: { isThread: vi.fn().mockReturnValue(false) },
      deferred: false,
      replied: false,
      reply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;

    await handler.handleInteraction(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: '❌ **Falha ao solicitar cancelamento**: Cancel turn failed',
      ephemeral: true,
    });
  });

  it('should use followUp on error if interaction is already replied or deferred', async () => {
    orchestratorService.throwError = true;
    const interaction = {
      isChatInputCommand: vi.fn().mockReturnValue(true),
      commandName: 'cancel',
      channelId: 'channel-123',
      channel: { isThread: vi.fn().mockReturnValue(false) },
      deferred: false,
      replied: true,
      reply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;

    await handler.handleInteraction(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith({
      content: '❌ **Falha ao solicitar cancelamento**: Cancel turn failed',
      ephemeral: true,
    });
  });

  it('should handle raw string error on cancel failure', async () => {
    orchestratorService.cancelTurn = vi
      .fn()
      .mockRejectedValueOnce('raw cancel error');
    const interaction = {
      isChatInputCommand: vi.fn().mockReturnValue(true),
      commandName: 'cancel',
      channelId: 'channel-123',
      channel: { isThread: vi.fn().mockReturnValue(false) },
      deferred: false,
      replied: false,
      reply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;

    await handler.handleInteraction(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: '❌ **Falha ao solicitar cancelamento**: raw cancel error',
      ephemeral: true,
    });
  });
});
