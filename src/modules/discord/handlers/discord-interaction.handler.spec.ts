import type {
  ChatInputCommandInteraction,
  Client,
  Interaction,
} from 'discord.js';
import { Events } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StartAgentConfigSelectionResult } from '../../orchestrator/models/agent-config-outcome.model.js';
import type { AgentQuotaReport } from '../../orchestrator/models/agent-quota-report.model.js';
import type { OrchestratorService } from '../../orchestrator/services/orchestrator.service.js';
import { DiscordActivityFormatter } from '../formatters/discord-activity.formatter.js';
import { DiscordClientService } from '../services/discord-client.service.js';

import { DiscordInteractionHandler } from './discord-interaction.handler.js';


class StubOrchestratorService implements Partial<OrchestratorService> {
  cancelledConversationId?: string;
  throwError = false;
  hasActiveTurn = true;
  hasActiveSelection = false;
  selectionResult: StartAgentConfigSelectionResult = {
    kind: 'selection',
    selection: {
      conversationId: 'channel-123',
      step: 'model',
      options: [{ index: 1, id: 'm1', label: 'Model 1' }],
    },
  };

  agentSelectionResult: StartAgentConfigSelectionResult = {
    kind: 'selection',
    selection: {
      conversationId: 'channel-123',
      step: 'agent',
      options: [{ index: 1, id: 'claude', label: 'Claude Code' }],
    },
  };

  quotaReport: AgentQuotaReport = {
    agent: { id: 'agy', name: 'Antigravity' },
    quota: undefined,
  };

  async getQuota(): Promise<AgentQuotaReport> {
    if (this.throwError) {
      throw new Error('quota down');
    }
    return this.quotaReport;
  }

  startedSelections: string[] = [];
  pendingQuestions = false;
  pendingQuestionLookups: string[] = [];

  hasPendingQuestions(conversationId: string): boolean {
    this.pendingQuestionLookups.push(conversationId);
    return this.pendingQuestions;
  }

  startedAgentSelections: string[] = [];
  languageRequests: string[] = [];
  pendingLanguageChange = false;

  async requestLanguageChange(conversationId: string): Promise<string> {
    if (this.throwError) {
      throw new Error('preferences down');
    }
    this.languageRequests.push(conversationId);
    return 'English';
  }

  cancelLanguageChange(_conversationId: string): boolean {
    return this.pendingLanguageChange;
  }

  async cancelTurn(conversationId: string): Promise<boolean> {
    if (this.throwError) {
      throw new Error('Cancel turn failed');
    }
    this.cancelledConversationId = conversationId;
    return this.hasActiveTurn;
  }

  async cancelConfigSelection(_conversationId: string): Promise<boolean> {
    return this.hasActiveSelection;
  }

  async startConfigSelection(conversationId: string): Promise<StartAgentConfigSelectionResult> {
    if (this.throwError) {
      throw new Error('agent down');
    }
    this.startedSelections.push(conversationId);
    return this.selectionResult;
  }

  async startAgentSelection(conversationId: string): Promise<StartAgentConfigSelectionResult> {
    if (this.throwError) {
      throw new Error('registry down');
    }
    this.startedAgentSelections.push(conversationId);
    return this.agentSelectionResult;
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

    expect(orchestratorService.cancelledConversationId).toBeUndefined();
  });

  it('should ignore unknown chat input commands', async () => {
    const interaction = buildInteraction({ commandName: 'help' });

    await handler.handleInteraction(interaction);

    expect(orchestratorService.cancelledConversationId).toBeUndefined();
    expect(orchestratorService.startedSelections).toHaveLength(0);
    expect(orchestratorService.startedAgentSelections).toHaveLength(0);
  });

  describe('/cancel', () => {
    it('should cancel in a standard channel and reply with an ephemeral confirmation', async () => {
      const interaction = buildInteraction();

      await handler.handleInteraction(interaction);

      expect(orchestratorService.cancelledConversationId).toBe('channel-123');
      expect(interaction.reply).toHaveBeenCalledWith({
        content: '🛑 **Cancellation requested.** The active turn will be stopped.',
        ephemeral: true,
      });
    });

    it('should use the parent channel and thread ids inside a thread', async () => {
      const interaction = buildInteraction({
        channelId: 'thread-777',
        channel: { id: 'thread-777', isThread: vi.fn().mockReturnValue(true), parentId: 'parent-channel-456' },
      });

      await handler.handleInteraction(interaction);

      expect(orchestratorService.cancelledConversationId).toBe('parent-channel-456:thread-777');
    });

    it('should fall back to the thread id when the thread has no parent', async () => {
      const interaction = buildInteraction({
        channelId: 'thread-777',
        channel: { id: 'thread-777', isThread: vi.fn().mockReturnValue(true), parentId: null },
      });

      await handler.handleInteraction(interaction);

      expect(orchestratorService.cancelledConversationId).toBe('thread-777:thread-777');
    });

    it('should confirm when only a selection was cancelled', async () => {
      orchestratorService.hasActiveTurn = false;
      orchestratorService.hasActiveSelection = true;
      const interaction = buildInteraction();

      await handler.handleInteraction(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '🛑 **Selection cancelled.**',
        ephemeral: true,
      });
    });

    it('should confirm when only a language change was cancelled', async () => {
      orchestratorService.hasActiveTurn = false;
      orchestratorService.pendingLanguageChange = true;
      const interaction = buildInteraction();

      await handler.handleInteraction(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '🛑 **Selection cancelled.**',
        ephemeral: true,
      });
    });

    it('should tell the user when there is nothing to cancel', async () => {
      orchestratorService.hasActiveTurn = false;
      const interaction = buildInteraction({ user: undefined });

      await handler.handleInteraction(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'ℹ️ There is no turn in progress to cancel.',
        ephemeral: true,
      });
    });

    it('should use followUp when the interaction was already replied', async () => {
      const interaction = buildInteraction({ replied: true });

      await handler.handleInteraction(interaction);

      expect(interaction.followUp).toHaveBeenCalledWith({
        content: '🛑 **Cancellation requested.** The active turn will be stopped.',
        ephemeral: true,
      });
    });

    it('should reply with the error message when cancelling fails', async () => {
      orchestratorService.throwError = true;
      const interaction = buildInteraction();

      await handler.handleInteraction(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ **Failed to request cancellation**: Cancel turn failed',
        ephemeral: true,
      });
    });

    it('should stringify non-Error failures', async () => {
      orchestratorService.cancelTurn = vi.fn().mockRejectedValueOnce('raw cancel error');
      const interaction = buildInteraction();

      await handler.handleInteraction(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ **Failed to request cancellation**: raw cancel error',
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

  describe('/usage', () => {
    it('should defer ephemerally and reply with the formatted quota', async () => {
      const interaction = buildInteraction({ commandName: 'usage' });

      await handler.handleInteraction(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'ℹ️ The Antigravity agent does not expose usage information.',
      });
    });

    it('should report the failure when the quota lookup throws', async () => {
      orchestratorService.throwError = true;
      const interaction = buildInteraction({ commandName: 'usage' });

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ **Failed to fetch usage**: quota down',
      });
    });
  });

  describe('/model', () => {
    const optionsText = '🧠 **Choose the agent model** by replying with the option number:\n**1.** Model 1';

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
      expect(interaction.editReply).toHaveBeenCalledWith({ content: '🧵 Choose the model in the thread below.' });
      expect(startThread).toHaveBeenCalledWith({ name: 'Model selection', autoArchiveDuration: 60 });
      expect(orchestratorService.startedSelections).toEqual(['channel-123:selection-thread']);
      expect(thread.send).toHaveBeenCalledWith(optionsText);
    });

    it('should show typing in the new thread while the options are loaded', async () => {
      let typingCallsDuringLoad = 0;
      const sendTyping = vi.fn().mockResolvedValue(undefined);
      const thread = { id: 'selection-thread', send: vi.fn().mockResolvedValue(undefined), sendTyping };
      const startConfigSelection = orchestratorService.startConfigSelection.bind(orchestratorService);
      orchestratorService.startConfigSelection = async (conversationId: string) => {
        typingCallsDuringLoad = sendTyping.mock.calls.length;
        return startConfigSelection(conversationId);
      };

      await handler.handleInteraction(guildChannelInteraction(vi.fn().mockResolvedValue(thread)));

      expect(typingCallsDuringLoad).toBe(1);
      expect(thread.send).toHaveBeenCalledWith(optionsText);
    });

    it('should explain inside the new thread when the agent exposes no models', async () => {
      orchestratorService.selectionResult = { kind: 'unavailable' };
      const thread = { id: 'selection-thread', send: vi.fn().mockResolvedValue(undefined) };

      await handler.handleInteraction(guildChannelInteraction(vi.fn().mockResolvedValue(thread)));

      expect(thread.send).toHaveBeenCalledWith('ℹ️ The current agent does not expose any models to select.');
    });

    it('should report the failure when the thread cannot be created', async () => {
      const interaction = guildChannelInteraction(vi.fn().mockRejectedValue(new Error('Missing Permissions')));

      await handler.handleInteraction(interaction);

      expect(orchestratorService.startedSelections).toEqual([]);
      expect(interaction.editReply).toHaveBeenLastCalledWith({
        content: '❌ **Failed to open model selection**: Missing Permissions',
      });
    });

    it('should publish the options in the current thread', async () => {
      const interaction = buildInteraction({
        commandName: 'model',
        channelId: 'thread-1',
        channel: { id: 'thread-1', isThread: vi.fn().mockReturnValue(true), parentId: 'channel-123' },
      });

      await handler.handleInteraction(interaction);

      expect(orchestratorService.startedSelections).toEqual(['channel-123:thread-1']);
      expect(interaction.editReply).toHaveBeenCalledWith({ content: optionsText });
    });

    it('should refuse to open the selection while the conversation has questions waiting', async () => {
      orchestratorService.pendingQuestions = true;
      const interaction = buildInteraction({
        commandName: 'model',
        channelId: 'thread-1',
        channel: { id: 'thread-1', isThread: vi.fn().mockReturnValue(true), parentId: 'channel-123' },
      });

      await handler.handleInteraction(interaction);

      expect(orchestratorService.pendingQuestionLookups).toEqual(['channel-123:thread-1']);
      expect(orchestratorService.startedSelections).toEqual([]);
      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('There are questions waiting for your answer'),
        ephemeral: true,
      });
    });

    it('should open the selection in a new thread from a channel even with questions waiting elsewhere', async () => {
      orchestratorService.pendingQuestions = true;
      const interaction = buildInteraction({ commandName: 'model' });

      await handler.handleInteraction(interaction);

      expect(orchestratorService.pendingQuestionLookups).toEqual([]);
      expect(interaction.deferReply).toHaveBeenCalled();
    });

    it('should publish the options in a direct message', async () => {
      const interaction = buildInteraction({ commandName: 'model', inGuild: false, channelId: 'dm-1', channel: null });

      await handler.handleInteraction(interaction);

      expect(orchestratorService.startedSelections).toEqual(['dm-1']);
      expect(interaction.editReply).toHaveBeenCalledWith({ content: optionsText });
    });

    it('should report failures starting the selection', async () => {
      orchestratorService.throwError = true;
      const interaction = buildInteraction({ commandName: 'model', inGuild: false, channel: null });

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ **Failed to open model selection**: agent down',
      });
    });
  });

  describe('/agent', () => {
    const optionsText = '🤖 **Choose the agent** by replying with the option number:\n**1.** Claude Code';

    const guildChannelInteraction = (startThread: ReturnType<typeof vi.fn>) => buildInteraction({
      commandName: 'agent',
      editReply: vi.fn().mockResolvedValue({ startThread }),
    });

    it('should open the agent selection in a new thread when used in a guild channel', async () => {
      const thread = { id: 'agent-thread', send: vi.fn().mockResolvedValue(undefined) };
      const startThread = vi.fn().mockResolvedValue(thread);
      const interaction = guildChannelInteraction(startThread);

      await handler.handleInteraction(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith();
      expect(interaction.editReply).toHaveBeenCalledWith({ content: '🧵 Choose the agent in the thread below.' });
      expect(startThread).toHaveBeenCalledWith({ name: 'Agent selection', autoArchiveDuration: 60 });
      expect(orchestratorService.startedAgentSelections).toEqual(['channel-123:agent-thread']);
      expect(orchestratorService.startedSelections).toEqual([]);
      expect(thread.send).toHaveBeenCalledWith(optionsText);
    });

    it('should explain inside the new thread when no agent is available', async () => {
      orchestratorService.agentSelectionResult = { kind: 'unavailable' };
      const thread = { id: 'agent-thread', send: vi.fn().mockResolvedValue(undefined) };

      await handler.handleInteraction(guildChannelInteraction(vi.fn().mockResolvedValue(thread)));

      expect(thread.send).toHaveBeenCalledWith('ℹ️ No agents available to select.');
    });

    it('should publish the agent options in the current thread', async () => {
      const interaction = buildInteraction({
        commandName: 'agent',
        channelId: 'thread-1',
        channel: { id: 'thread-1', isThread: vi.fn().mockReturnValue(true), parentId: 'channel-123' },
      });

      await handler.handleInteraction(interaction);

      expect(orchestratorService.startedAgentSelections).toEqual(['channel-123:thread-1']);
      expect(interaction.editReply).toHaveBeenCalledWith({ content: optionsText });
    });

    it('should publish the agent options in a direct message', async () => {
      const interaction = buildInteraction({ commandName: 'agent', inGuild: false, channelId: 'dm-1', channel: null });

      await handler.handleInteraction(interaction);

      expect(orchestratorService.startedAgentSelections).toEqual(['dm-1']);
      expect(interaction.editReply).toHaveBeenCalledWith({ content: optionsText });
    });

    it('should report failures starting the agent selection', async () => {
      orchestratorService.throwError = true;
      const interaction = buildInteraction({ commandName: 'agent', inGuild: false, channel: null });

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ **Failed to open agent selection**: registry down',
      });
    });
  });

  describe('/language', () => {
    const requestText = '🌐 **Current language**: English\nReply with the language the agents should use to talk to you, such as "Spanish" or "Português".';

    it('should ask for the language in a new thread when used in a guild channel', async () => {
      const thread = { id: 'language-thread', send: vi.fn().mockResolvedValue(undefined) };
      const startThread = vi.fn().mockResolvedValue(thread);
      const interaction = buildInteraction({
        commandName: 'language',
        editReply: vi.fn().mockResolvedValue({ startThread }),
      });

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({ content: '🧵 Choose the language in the thread below.' });
      expect(startThread).toHaveBeenCalledWith({ name: 'Language selection', autoArchiveDuration: 60 });
      expect(orchestratorService.languageRequests).toEqual(['channel-123:language-thread']);
      expect(thread.send).toHaveBeenCalledWith(requestText);
    });

    it('should ask for the language in a direct message', async () => {
      const interaction = buildInteraction({ commandName: 'language', inGuild: false, channelId: 'dm-1', channel: null });

      await handler.handleInteraction(interaction);

      expect(orchestratorService.languageRequests).toEqual(['dm-1']);
      expect(interaction.editReply).toHaveBeenCalledWith({ content: requestText });
    });

    it('should refuse while questions wait for an answer', async () => {
      orchestratorService.pendingQuestions = true;
      const interaction = buildInteraction({ commandName: 'language', inGuild: false, channelId: 'dm-1', channel: null });

      await handler.handleInteraction(interaction);

      expect(orchestratorService.languageRequests).toEqual([]);
      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❓ There are questions waiting for your answer in this conversation. Answer them or use /cancel before switching agent, model or language.',
        ephemeral: true,
      });
    });

    it('should report failures requesting the language', async () => {
      orchestratorService.throwError = true;
      const interaction = buildInteraction({ commandName: 'language', inGuild: false, channel: null });

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ **Failed to open language selection**: preferences down',
      });
    });
  });
});
