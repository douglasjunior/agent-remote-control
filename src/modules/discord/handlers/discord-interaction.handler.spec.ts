import type {
  ChatInputCommandInteraction,
  Client,
  Interaction,
} from 'discord.js';
import { Events } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StartAgentConfigSelectionResult } from '../../orchestrator/models/agent-config-outcome.model.js';
import type { OrchestratorService } from '../../orchestrator/services/orchestrator.service.js';
import { DiscordActivityFormatter } from '../formatters/discord-activity.formatter.js';
import { DiscordClientService } from '../services/discord-client.service.js';

import { DiscordInteractionHandler } from './discord-interaction.handler.js';


class StubOrchestratorService implements Partial<OrchestratorService> {
  cancelledChannelId?: string;
  cancelledThreadId?: string;
  throwError = false;
  hasActiveTurn = true;
  hasActiveSelection = false;
  selectionResult: StartAgentConfigSelectionResult = {
    kind: 'selection',
    selection: {
      channelId: 'channel-123',
      step: 'model',
      options: [{ index: 1, id: 'm1', label: 'Model 1' }],
    },
  };

  startedSelections: { channelId: string; threadId?: string }[] = [];

  async cancelTurn(channelId: string, threadId?: string): Promise<boolean> {
    if (this.throwError) {
      throw new Error('Cancel turn failed');
    }
    this.cancelledChannelId = channelId;
    this.cancelledThreadId = threadId;
    return this.hasActiveTurn;
  }

  async cancelConfigSelection(): Promise<boolean> {
    return this.hasActiveSelection;
  }

  async startConfigSelection(channelId: string, threadId?: string): Promise<StartAgentConfigSelectionResult> {
    if (this.throwError) {
      throw new Error('agent down');
    }
    this.startedSelections.push({ channelId, threadId });
    return this.selectionResult;
  }
}

type InteractionOverrides = {
  commandName?: string;
  channelId?: string;
  channel?: unknown;
  inGuild?: boolean;
  user?: unknown;
  editReply?: ReturnType<typeof vi.fn>;
  deferred?: boolean;
  replied?: boolean;
  reply?: ReturnType<typeof vi.fn>;
  followUp?: ReturnType<typeof vi.fn>;
};

function buildInteraction({ inGuild = true, ...overrides }: InteractionOverrides = {}): ChatInputCommandInteraction {
  const interaction = {
    inGuild: vi.fn().mockReturnValue(inGuild),
    isChatInputCommand: vi.fn().mockReturnValue(true),
    commandName: 'cancel',
    channelId: 'channel-123',
    channel: { isThread: vi.fn().mockReturnValue(false) },
    user: { username: 'alice', id: 'u-1' },
    deferred: false,
    replied: false,
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn(async () => {
      interaction.deferred = true;
    }),
    ...overrides,
  };
  return interaction as unknown as ChatInputCommandInteraction;
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
      new DiscordActivityFormatter(),
    );
  });

  const captureListener = () => {
    let interactionListener: ((interaction: Interaction) => void) | undefined;
    vi.mocked(mockClient.on).mockImplementation(((event: string, cb: any) => {
      if (event === Events.InteractionCreate) {
        interactionListener = cb;
      }
      return mockClient;
    }) as any);
    handler.onModuleInit();
    return interactionListener!;
  };

  it('should register interactionCreate listener on onModuleInit and invoke callback', () => {
    const listener = captureListener();

    const nonChatInput = {
      isChatInputCommand: vi.fn().mockReturnValue(false),
    } as unknown as Interaction;
    listener(nonChatInput);

    expect(nonChatInput.isChatInputCommand).toHaveBeenCalled();
  });

  it('should log instead of rejecting when the handler itself fails', async () => {
    const listener = captureListener();
    const broken = {
      isChatInputCommand: vi.fn(() => {
        throw new Error('broken interaction');
      }),
    } as unknown as Interaction;

    expect(() => listener(broken)).not.toThrow();
    await vi.waitFor(() => expect(broken.isChatInputCommand).toHaveBeenCalled());
  });

  it('should ignore interactions that are not chat input commands', async () => {
    const interaction = {
      isChatInputCommand: vi.fn().mockReturnValue(false),
    } as unknown as Interaction;

    await handler.handleInteraction(interaction);

    expect(orchestratorService.cancelledChannelId).toBeUndefined();
  });

  it('should ignore unknown chat input commands', async () => {
    const interaction = buildInteraction({ commandName: 'help' });

    await handler.handleInteraction(interaction);

    expect(orchestratorService.cancelledChannelId).toBeUndefined();
    expect(orchestratorService.startedSelections).toHaveLength(0);
  });

  describe('/cancel', () => {
    it('should cancel in a standard channel and reply with an ephemeral confirmation', async () => {
      const interaction = buildInteraction();

      await handler.handleInteraction(interaction);

      expect(orchestratorService.cancelledChannelId).toBe('channel-123');
      expect(orchestratorService.cancelledThreadId).toBeUndefined();
      expect(interaction.reply).toHaveBeenCalledWith({
        content: '🛑 **Cancelamento solicitado.** O turno ativo será interrompido.',
        ephemeral: true,
      });
    });

    it('should use the parent channel and thread ids inside a thread', async () => {
      const interaction = buildInteraction({
        channelId: 'thread-777',
        channel: { id: 'thread-777', isThread: vi.fn().mockReturnValue(true), parentId: 'parent-channel-456' },
      });

      await handler.handleInteraction(interaction);

      expect(orchestratorService.cancelledChannelId).toBe('parent-channel-456');
      expect(orchestratorService.cancelledThreadId).toBe('thread-777');
    });

    it('should fall back to the thread id when the thread has no parent', async () => {
      const interaction = buildInteraction({
        channelId: 'thread-777',
        channel: { id: 'thread-777', isThread: vi.fn().mockReturnValue(true), parentId: null },
      });

      await handler.handleInteraction(interaction);

      expect(orchestratorService.cancelledChannelId).toBe('thread-777');
      expect(orchestratorService.cancelledThreadId).toBe('thread-777');
    });

    it('should confirm when only a model selection was cancelled', async () => {
      orchestratorService.hasActiveTurn = false;
      orchestratorService.hasActiveSelection = true;
      const interaction = buildInteraction();

      await handler.handleInteraction(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '🛑 **Seleção de modelo cancelada.**',
        ephemeral: true,
      });
    });

    it('should tell the user when there is nothing to cancel', async () => {
      orchestratorService.hasActiveTurn = false;
      const interaction = buildInteraction({ user: undefined });

      await handler.handleInteraction(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'ℹ️ Não há nenhum turno em andamento para cancelar.',
        ephemeral: true,
      });
    });

    it('should use followUp when the interaction was already replied', async () => {
      const interaction = buildInteraction({ replied: true });

      await handler.handleInteraction(interaction);

      expect(interaction.followUp).toHaveBeenCalledWith({
        content: '🛑 **Cancelamento solicitado.** O turno ativo será interrompido.',
        ephemeral: true,
      });
    });

    it('should reply with the error message when cancelling fails', async () => {
      orchestratorService.throwError = true;
      const interaction = buildInteraction();

      await handler.handleInteraction(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ **Falha ao solicitar cancelamento**: Cancel turn failed',
        ephemeral: true,
      });
    });

    it('should stringify non-Error failures', async () => {
      orchestratorService.cancelTurn = vi.fn().mockRejectedValueOnce('raw cancel error');
      const interaction = buildInteraction();

      await handler.handleInteraction(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ **Falha ao solicitar cancelamento**: raw cancel error',
        ephemeral: true,
      });
    });

    it('should not reject when both the cancel and the error reply fail', async () => {
      orchestratorService.throwError = true;
      const interaction = buildInteraction({
        reply: vi.fn().mockRejectedValue(new Error('Unknown interaction')),
      });

      await expect(handler.handleInteraction(interaction)).resolves.toBeUndefined();
      expect(interaction.reply).toHaveBeenCalledTimes(1);
    });
  });

  describe('/model', () => {
    const optionsText = '🧠 **Escolha o modelo do agente** respondendo com o número da opção:\n**1.** Model 1';

    const guildChannelInteraction = (startThread: ReturnType<typeof vi.fn>) => buildInteraction({
      commandName: 'model',
      editReply: vi.fn().mockResolvedValue({ startThread }),
    });

    it('should open the selection in a new thread when used in a guild channel', async () => {
      const thread = { id: 'selection-thread', send: vi.fn().mockResolvedValue(undefined) };
      const startThread = vi.fn().mockResolvedValue(thread);
      const interaction = guildChannelInteraction(startThread);

      await handler.handleInteraction(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith();
      expect(interaction.editReply).toHaveBeenCalledWith({ content: '🧵 Escolha o modelo na thread abaixo.' });
      expect(startThread).toHaveBeenCalledWith({ name: 'Seleção de modelo', autoArchiveDuration: 60 });
      expect(orchestratorService.startedSelections).toEqual([{ channelId: 'channel-123', threadId: 'selection-thread' }]);
      expect(thread.send).toHaveBeenCalledWith(optionsText);
    });

    it('should explain inside the new thread when the agent exposes no models', async () => {
      orchestratorService.selectionResult = { kind: 'unavailable' };
      const thread = { id: 'selection-thread', send: vi.fn().mockResolvedValue(undefined) };

      await handler.handleInteraction(guildChannelInteraction(vi.fn().mockResolvedValue(thread)));

      expect(thread.send).toHaveBeenCalledWith('ℹ️ O agente atual não expõe modelos para seleção.');
    });

    it('should report the failure when the thread cannot be created', async () => {
      const interaction = guildChannelInteraction(vi.fn().mockRejectedValue(new Error('Missing Permissions')));

      await handler.handleInteraction(interaction);

      expect(orchestratorService.startedSelections).toEqual([]);
      expect(interaction.editReply).toHaveBeenLastCalledWith({
        content: '❌ **Falha ao abrir a seleção de modelo**: Missing Permissions',
      });
    });

    it('should publish the options in the current thread', async () => {
      const interaction = buildInteraction({
        commandName: 'model',
        channelId: 'thread-1',
        channel: { id: 'thread-1', isThread: vi.fn().mockReturnValue(true), parentId: 'channel-123' },
      });

      await handler.handleInteraction(interaction);

      expect(orchestratorService.startedSelections).toEqual([{ channelId: 'channel-123', threadId: 'thread-1' }]);
      expect(interaction.editReply).toHaveBeenCalledWith({ content: optionsText });
    });

    it('should publish the options in a direct message', async () => {
      const interaction = buildInteraction({ commandName: 'model', inGuild: false, channelId: 'dm-1', channel: null });

      await handler.handleInteraction(interaction);

      expect(orchestratorService.startedSelections).toEqual([{ channelId: 'dm-1', threadId: undefined }]);
      expect(interaction.editReply).toHaveBeenCalledWith({ content: optionsText });
    });

    it('should report failures starting the selection', async () => {
      orchestratorService.throwError = true;
      const interaction = buildInteraction({ commandName: 'model', inGuild: false, channel: null });

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ **Falha ao abrir a seleção de modelo**: agent down',
      });
    });
  });
});
