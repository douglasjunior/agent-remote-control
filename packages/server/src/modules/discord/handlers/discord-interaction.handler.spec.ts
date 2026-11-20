import { beforeEach, describe, expect, it, rs } from '@rstest/core';
import type {
  ChatInputCommandInteraction,
  Client,
  Interaction,
} from 'discord.js';
import { Events } from 'discord.js';

import { StubAgentAuthPort } from '../../agent/testing/stub-agent-auth.port.js';
import type { AgentQuotaReport } from '../../orchestrator/models/agent-quota-report.model.js';
import { StubAgentTurnPort } from '../../orchestrator/testing/stub-agent-turn.port.js';
import { StubUserQuestionPort } from '../../orchestrator/testing/stub-user-question.port.js';
import { SettingsChangeNotifierService } from '../../settings/services/settings-change-notifier.service.js';
import { StubRuntimeSettings } from '../../settings/testing/stub-runtime-settings.js';
import { DiscordActivityFormatter } from '../formatters/discord-activity.formatter.js';
import type { StartAgentAuthSelectionResult, StartAgentConfigSelectionResult } from '../models/agent-config-outcome.model.js';
import { DiscordClientService } from '../services/discord-client.service.js';
import type { DiscordConversationService } from '../services/discord-conversation.service.js';

import { DiscordInteractionHandler } from './discord-interaction.handler.js';


/** Stands in for both the orchestrator and the Discord conversation service the handler calls. */
/** Stands in for the Discord dialog state the handler starts and cancels. */
class StubDiscordConversationService implements Partial<DiscordConversationService> {
  throwError = false;
  hasActiveSelection = false;
  pendingLanguageChange = false;
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

  profilesSelectionResult: StartAgentConfigSelectionResult = {
    kind: 'profiles_menu',
    selection: {
      conversationId: 'channel-123',
      step: 'profile',
      options: [{ index: 1, id: 'CEO', label: 'CEO', description: 'Claude Code - default - default' }],
    },
  };

  startedSelections: string[] = [];
  startedAgentSelections: string[] = [];
  squadSelectionResult: StartAgentConfigSelectionResult = {
    kind: 'selection',
    selection: {
      conversationId: 'channel-123',
      step: 'squad',
      options: [{ index: 1, id: 's-1', label: 'Backend team', description: '2 roles · Claude Code (default)' }],
    },
  };

  startedProfilesSelections: string[] = [];
  startedSquadSelections: string[] = [];
  languageRequests: string[] = [];
  agentAuthSelectionResult: StartAgentAuthSelectionResult = {
    kind: 'menu',
    entries: [
      { index: 1, agentId: 'claude', displayName: 'Claude Code', status: 'authenticated', detail: 'me@example.com' },
      { index: 2, agentId: 'codex', displayName: 'OpenAI Codex', status: 'unauthenticated' },
    ],
  };

  startedAgentAuthSelections: string[] = [];
  pendingAgentAuth = false;

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

  async startProfilesSelection(conversationId: string): Promise<StartAgentConfigSelectionResult> {
    if (this.throwError) {
      throw new Error('profiles down');
    }
    this.startedProfilesSelections.push(conversationId);
    return this.profilesSelectionResult;
  }

  async startSquadSelection(conversationId: string): Promise<StartAgentConfigSelectionResult> {
    if (this.throwError) {
      throw new Error('squads down');
    }
    this.startedSquadSelections.push(conversationId);
    return this.squadSelectionResult;
  }

  async cancelConfigSelection(_conversationId: string): Promise<boolean> {
    return this.hasActiveSelection;
  }

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

  async startAgentAuthSelection(conversationId: string): Promise<StartAgentAuthSelectionResult> {
    if (this.throwError) {
      throw new Error('auth down');
    }
    this.startedAgentAuthSelections.push(conversationId);
    return this.agentAuthSelectionResult;
  }

  cancelAgentAuth(_conversationId: string): boolean {
    return this.pendingAgentAuth;
  }
}

type InteractionOverrides = {
  commandName?: string;
  channelId?: string;
  channel?: unknown;
  inGuild?: boolean;
  user?: unknown;
  editReply?: ReturnType<typeof rs.fn>;
  options?: unknown;
  deferred?: boolean;
  replied?: boolean;
  reply?: ReturnType<typeof rs.fn>;
  followUp?: ReturnType<typeof rs.fn>;
};

function buildInteraction({ inGuild = true, ...overrides }: InteractionOverrides = {}): ChatInputCommandInteraction {
  const interaction = {
    inGuild: rs.fn().mockReturnValue(inGuild),
    isChatInputCommand: rs.fn().mockReturnValue(true),
    commandName: 'cancel',
    channelId: 'channel-123',
    channel: { isThread: rs.fn().mockReturnValue(false) },
    user: { username: 'alice', id: 'u-1' },
    deferred: false,
    replied: false,
    reply: rs.fn().mockResolvedValue(undefined),
    followUp: rs.fn().mockResolvedValue(undefined),
    editReply: rs.fn().mockResolvedValue(undefined),
    deferReply: rs.fn(async () => {
      interaction.deferred = true;
    }),
    ...overrides,
  };
  return interaction as unknown as ChatInputCommandInteraction;
}

function buildLongQuotaReports(): AgentQuotaReport[] {
  return Array.from({ length: 30 }, (_, position) => ({
    agent: { id: `agent-${position}`, name: `Agent ${position}` },
    status: 'ok' as const,
    quota: {
      groups: Array.from({ length: 4 }, (_unused, group) => ({
        name: `Group ${group}`,
        buckets: [{ id: `b-${position}-${group}`, name: 'Weekly limit remaining', window: 'weekly', remainingFraction: 0.5 }],
      })),
    },
  }));
}

describe('DiscordInteractionHandler', () => {
  let mockClient: Client;
  let clientService: DiscordClientService;
  let agentTurn: StubAgentTurnPort;
  let questions: StubUserQuestionPort;
  let dialogs: StubDiscordConversationService;
  let handler: DiscordInteractionHandler;

  beforeEach(() => {
    mockClient = {
      on: rs.fn(),
    } as unknown as Client;

    agentTurn = new StubAgentTurnPort();
    questions = new StubUserQuestionPort();
    dialogs = new StubDiscordConversationService();
    agentTurn.shellEnabled = false;
    agentTurn.shellResult = {
      command: 'df -h',
      exitCode: 0,
      output: 'Filesystem',
      truncated: false,
      timedOut: false,
      cancelled: false,
    };
    agentTurn.quotaReports = [{ agent: { id: 'agy', name: 'Antigravity' }, status: 'unsupported' }];
    clientService = new DiscordClientService(agentTurn, new StubAgentAuthPort(), new StubRuntimeSettings(), new SettingsChangeNotifierService(), () => mockClient);
    handler = new DiscordInteractionHandler(
      clientService,
      agentTurn,
      questions,
      dialogs as unknown as DiscordConversationService,
      new DiscordActivityFormatter(),
    );
  });

  const captureListener = () => {
    let interactionListener: ((interaction: Interaction) => void) | undefined;
    rs.mocked(mockClient.on).mockImplementation(((event: string, cb: any) => {
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
      isChatInputCommand: rs.fn().mockReturnValue(false),
    } as unknown as Interaction;
    listener(nonChatInput);

    expect(nonChatInput.isChatInputCommand).toHaveBeenCalled();
  });

  it('should log instead of rejecting when the handler itself fails', async () => {
    const listener = captureListener();
    const broken = {
      isChatInputCommand: rs.fn(() => {
        throw new Error('broken interaction');
      }),
    } as unknown as Interaction;

    expect(() => listener(broken)).not.toThrow();
    await rs.waitFor(() => expect(broken.isChatInputCommand).toHaveBeenCalled());
  });

  it('should ignore interactions that are not chat input commands', async () => {
    const interaction = {
      isChatInputCommand: rs.fn().mockReturnValue(false),
    } as unknown as Interaction;

    await handler.handleInteraction(interaction);

    expect(agentTurn.cancelledConversations.at(-1)).toBeUndefined();
  });

  it('should ignore unknown chat input commands', async () => {
    const interaction = buildInteraction({ commandName: 'help' });

    await handler.handleInteraction(interaction);

    expect(agentTurn.cancelledConversations.at(-1)).toBeUndefined();
    expect(dialogs.startedSelections).toHaveLength(0);
    expect(dialogs.startedAgentSelections).toHaveLength(0);
  });

  describe('/cancel', () => {
    it('should cancel in a standard channel and reply with an ephemeral confirmation', async () => {
      const interaction = buildInteraction();

      await handler.handleInteraction(interaction);

      expect(agentTurn.cancelledConversations.at(-1)).toBe('channel-123');
      expect(interaction.reply).toHaveBeenCalledWith({
        content: '🛑 **Cancellation requested.** The active turn will be stopped.',
        ephemeral: true,
      });
    });

    it('should use the parent channel and thread ids inside a thread', async () => {
      const interaction = buildInteraction({
        channelId: 'thread-777',
        channel: { id: 'thread-777', isThread: rs.fn().mockReturnValue(true), parentId: 'parent-channel-456' },
      });

      await handler.handleInteraction(interaction);

      expect(agentTurn.cancelledConversations.at(-1)).toBe('parent-channel-456:thread-777');
    });

    it('should fall back to the thread id when the thread has no parent', async () => {
      const interaction = buildInteraction({
        channelId: 'thread-777',
        channel: { id: 'thread-777', isThread: rs.fn().mockReturnValue(true), parentId: null },
      });

      await handler.handleInteraction(interaction);

      expect(agentTurn.cancelledConversations.at(-1)).toBe('thread-777:thread-777');
    });

    it('should confirm when only a selection was cancelled', async () => {
      agentTurn.cancelResult = false;
      dialogs.hasActiveSelection = true;
      const interaction = buildInteraction();

      await handler.handleInteraction(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '🛑 **Selection cancelled.**',
        ephemeral: true,
      });
    });

    it('should confirm when only a language change was cancelled', async () => {
      agentTurn.cancelResult = false;
      dialogs.pendingLanguageChange = true;
      const interaction = buildInteraction();

      await handler.handleInteraction(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '🛑 **Selection cancelled.**',
        ephemeral: true,
      });
    });

    it('should tell the user when there is nothing to cancel', async () => {
      agentTurn.cancelResult = false;
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
      agentTurn.throwOnCancel = true;
      const interaction = buildInteraction();

      await handler.handleInteraction(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ **Failed to request cancellation**: Cancel turn failed',
        ephemeral: true,
      });
    });

    it('should stringify non-Error failures', async () => {
      agentTurn.cancelTurn = rs.fn().mockRejectedValueOnce('raw cancel error');
      const interaction = buildInteraction();

      await handler.handleInteraction(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ **Failed to request cancellation**: raw cancel error',
        ephemeral: true,
      });
    });

    it('should not reject when both the cancel and the error reply fail', async () => {
      agentTurn.throwOnCancel = true;
      const interaction = buildInteraction({
        reply: rs.fn().mockRejectedValue(new Error('Unknown interaction')),
      });

      await expect(handler.handleInteraction(interaction)).resolves.toBeUndefined();
      expect(interaction.reply).toHaveBeenCalledTimes(1);
    });
  });

  describe('/shell', () => {
    const buildShellInteraction = () => buildInteraction({
      commandName: 'shell',
      options: { getString: rs.fn().mockReturnValue('df -h') },
    });

    it('should defer ephemerally, run the command and reply with the formatted result', async () => {
      const interaction = buildShellInteraction();

      await handler.handleInteraction(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(agentTurn.shellCalls).toEqual([{ conversationId: 'channel-123', command: 'df -h' }]);
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '```\n$ df -h\nFilesystem\n```\n✅ **Exit code 0**',
      });
    });

    it('should report a failure to run the command', async () => {
      agentTurn.throwOnShell = true;
      const interaction = buildShellInteraction();

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ **Failed to run command**: shell down',
      });
    });
  });

  describe('/usage', () => {
    it('should defer ephemerally and reply with the formatted quota', async () => {
      const interaction = buildInteraction({ commandName: 'usage' });

      await handler.handleInteraction(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '📊 **Antigravity usage**\nℹ️ This agent does not expose usage information.',
      });
    });

    it('should split a report over 2000 characters into an editReply and ephemeral follow-ups', async () => {
      agentTurn.quotaReports = buildLongQuotaReports();
      const interaction = buildInteraction({ commandName: 'usage' });

      await handler.handleInteraction(interaction);

      const followUps = rs.mocked(interaction.followUp).mock.calls.map(([options]) => options as { content: string; ephemeral: boolean });
      const contents = [
        (rs.mocked(interaction.editReply).mock.calls[0]![0] as { content: string }).content,
        ...followUps.map(options => options.content),
      ];
      expect(followUps.length).toBeGreaterThan(0);
      expect(followUps.every(options => options.ephemeral)).toBe(true);
      expect(contents.every(content => content.length <= 2000)).toBe(true);
      expect(contents.join('\n')).toContain('📊 **Agent 29 usage**');
    });

    it('should log and stop sending chunks when a follow-up fails', async () => {
      agentTurn.quotaReports = buildLongQuotaReports();
      const interaction = buildInteraction({
        commandName: 'usage',
        followUp: rs.fn().mockRejectedValue(new Error('Unknown webhook')),
      });

      await expect(handler.handleInteraction(interaction)).resolves.toBeUndefined();
      expect(interaction.followUp).toHaveBeenCalledTimes(1);
    });

    it('should report the failure when the quota lookup throws', async () => {
      agentTurn.throwOnQuota = true;
      const interaction = buildInteraction({ commandName: 'usage' });

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ **Failed to fetch usage**: quota down',
      });
    });
  });

  describe('/model', () => {
    const optionsText = '🧠 **Choose the agent model** by replying with the option number:\n**1.** Model 1';

    const guildChannelInteraction = (startThread: ReturnType<typeof rs.fn>) => buildInteraction({
      commandName: 'model',
      editReply: rs.fn().mockResolvedValue({ startThread }),
    });

    it('should open the selection in a new thread when used in a guild channel', async () => {
      const thread = { id: 'selection-thread', send: rs.fn().mockResolvedValue(undefined) };
      const startThread = rs.fn().mockResolvedValue(thread);
      const interaction = guildChannelInteraction(startThread);

      await handler.handleInteraction(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith();
      expect(interaction.editReply).toHaveBeenCalledWith({ content: '🧵 Choose the model in the thread below.' });
      expect(startThread).toHaveBeenCalledWith({ name: 'Model selection', autoArchiveDuration: 60 });
      expect(dialogs.startedSelections).toEqual(['channel-123:selection-thread']);
      expect(thread.send).toHaveBeenCalledWith(optionsText);
    });

    it('should show typing in the new thread while the options are loaded', async () => {
      let typingCallsDuringLoad = 0;
      const sendTyping = rs.fn().mockResolvedValue(undefined);
      const thread = { id: 'selection-thread', send: rs.fn().mockResolvedValue(undefined), sendTyping };
      const startConfigSelection = dialogs.startConfigSelection.bind(dialogs);
      dialogs.startConfigSelection = async (conversationId: string) => {
        typingCallsDuringLoad = sendTyping.mock.calls.length;
        return startConfigSelection(conversationId);
      };

      await handler.handleInteraction(guildChannelInteraction(rs.fn().mockResolvedValue(thread)));

      expect(typingCallsDuringLoad).toBe(1);
      expect(thread.send).toHaveBeenCalledWith(optionsText);
    });

    it('should explain inside the new thread when the agent exposes no models', async () => {
      dialogs.selectionResult = { kind: 'unavailable' };
      const thread = { id: 'selection-thread', send: rs.fn().mockResolvedValue(undefined) };

      await handler.handleInteraction(guildChannelInteraction(rs.fn().mockResolvedValue(thread)));

      expect(thread.send).toHaveBeenCalledWith('ℹ️ The current agent does not expose any models to select.');
    });

    it('should report the failure when the thread cannot be created', async () => {
      const interaction = guildChannelInteraction(rs.fn().mockRejectedValue(new Error('Missing Permissions')));

      await handler.handleInteraction(interaction);

      expect(dialogs.startedSelections).toEqual([]);
      expect(interaction.editReply).toHaveBeenLastCalledWith({
        content: '❌ **Failed to open model selection**: Missing Permissions',
      });
    });

    it('should publish the options in the current thread', async () => {
      const interaction = buildInteraction({
        commandName: 'model',
        channelId: 'thread-1',
        channel: { id: 'thread-1', isThread: rs.fn().mockReturnValue(true), parentId: 'channel-123' },
      });

      await handler.handleInteraction(interaction);

      expect(dialogs.startedSelections).toEqual(['channel-123:thread-1']);
      expect(interaction.editReply).toHaveBeenCalledWith({ content: optionsText });
    });

    it('should refuse to open the selection while the conversation has questions waiting', async () => {
      questions.pending = true;
      const interaction = buildInteraction({
        commandName: 'model',
        channelId: 'thread-1',
        channel: { id: 'thread-1', isThread: rs.fn().mockReturnValue(true), parentId: 'channel-123' },
      });

      await handler.handleInteraction(interaction);

      expect(questions.pendingLookups).toEqual(['channel-123:thread-1']);
      expect(dialogs.startedSelections).toEqual([]);
      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('There are questions waiting for your answer'),
        ephemeral: true,
      });
    });

    it('should open the selection in a new thread from a channel even with questions waiting elsewhere', async () => {
      questions.pending = true;
      const interaction = buildInteraction({ commandName: 'model' });

      await handler.handleInteraction(interaction);

      expect(questions.pendingLookups).toEqual([]);
      expect(interaction.deferReply).toHaveBeenCalled();
    });

    it('should publish the options in a direct message', async () => {
      const interaction = buildInteraction({ commandName: 'model', inGuild: false, channelId: 'dm-1', channel: null });

      await handler.handleInteraction(interaction);

      expect(dialogs.startedSelections).toEqual(['dm-1']);
      expect(interaction.editReply).toHaveBeenCalledWith({ content: optionsText });
    });

    it('should report failures starting the selection', async () => {
      dialogs.throwError = true;
      const interaction = buildInteraction({ commandName: 'model', inGuild: false, channel: null });

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ **Failed to open model selection**: agent down',
      });
    });
  });

  describe('/agent', () => {
    const optionsText = '🤖 **Choose the agent** by replying with the option number:\n**1.** Claude Code';

    const guildChannelInteraction = (startThread: ReturnType<typeof rs.fn>) => buildInteraction({
      commandName: 'agent',
      editReply: rs.fn().mockResolvedValue({ startThread }),
    });

    it('should open the agent selection in a new thread when used in a guild channel', async () => {
      const thread = { id: 'agent-thread', send: rs.fn().mockResolvedValue(undefined) };
      const startThread = rs.fn().mockResolvedValue(thread);
      const interaction = guildChannelInteraction(startThread);

      await handler.handleInteraction(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith();
      expect(interaction.editReply).toHaveBeenCalledWith({ content: '🧵 Choose the agent in the thread below.' });
      expect(startThread).toHaveBeenCalledWith({ name: 'Agent selection', autoArchiveDuration: 60 });
      expect(dialogs.startedAgentSelections).toEqual(['channel-123:agent-thread']);
      expect(dialogs.startedSelections).toEqual([]);
      expect(thread.send).toHaveBeenCalledWith(optionsText);
    });

    it('should explain inside the new thread when no agent is available', async () => {
      dialogs.agentSelectionResult = { kind: 'unavailable' };
      const thread = { id: 'agent-thread', send: rs.fn().mockResolvedValue(undefined) };

      await handler.handleInteraction(guildChannelInteraction(rs.fn().mockResolvedValue(thread)));

      expect(thread.send).toHaveBeenCalledWith('ℹ️ No agents available to select.');
    });

    it('should publish the agent options in the current thread', async () => {
      const interaction = buildInteraction({
        commandName: 'agent',
        channelId: 'thread-1',
        channel: { id: 'thread-1', isThread: rs.fn().mockReturnValue(true), parentId: 'channel-123' },
      });

      await handler.handleInteraction(interaction);

      expect(dialogs.startedAgentSelections).toEqual(['channel-123:thread-1']);
      expect(interaction.editReply).toHaveBeenCalledWith({ content: optionsText });
    });

    it('should publish the agent options in a direct message', async () => {
      const interaction = buildInteraction({ commandName: 'agent', inGuild: false, channelId: 'dm-1', channel: null });

      await handler.handleInteraction(interaction);

      expect(dialogs.startedAgentSelections).toEqual(['dm-1']);
      expect(interaction.editReply).toHaveBeenCalledWith({ content: optionsText });
    });

    it('should report failures starting the agent selection', async () => {
      dialogs.throwError = true;
      const interaction = buildInteraction({ commandName: 'agent', inGuild: false, channel: null });

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ **Failed to open agent selection**: registry down',
      });
    });
  });

  describe('/profiles', () => {
    const menuText = '👥 **Choose the profiles to configure** — type numbers separated by commas, or 0 to exit:\n**1.** CEO — Claude Code - default - default';

    const guildChannelInteraction = (startThread: ReturnType<typeof rs.fn>) => buildInteraction({
      commandName: 'profiles',
      editReply: rs.fn().mockResolvedValue({ startThread }),
    });

    it('should open the profile list in a new thread when used in a guild channel', async () => {
      const thread = { id: 'profiles-thread', send: rs.fn().mockResolvedValue(undefined) };
      const startThread = rs.fn().mockResolvedValue(thread);
      const interaction = guildChannelInteraction(startThread);

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({ content: '🧵 Configure the profiles in the thread below.' });
      expect(startThread).toHaveBeenCalledWith({ name: 'Profile configuration', autoArchiveDuration: 60 });
      expect(dialogs.startedProfilesSelections).toEqual(['channel-123:profiles-thread']);
      expect(thread.send).toHaveBeenCalledWith(menuText);
    });

    it('should explain inside the new thread when no profile is available', async () => {
      dialogs.profilesSelectionResult = { kind: 'unavailable' };
      const thread = { id: 'profiles-thread', send: rs.fn().mockResolvedValue(undefined) };

      await handler.handleInteraction(guildChannelInteraction(rs.fn().mockResolvedValue(thread)));

      expect(thread.send).toHaveBeenCalledWith('ℹ️ No profiles available to configure.');
    });

    it('should publish the profile list in the current thread', async () => {
      const interaction = buildInteraction({
        commandName: 'profiles',
        channelId: 'thread-1',
        channel: { id: 'thread-1', isThread: rs.fn().mockReturnValue(true), parentId: 'channel-123' },
      });

      await handler.handleInteraction(interaction);

      expect(dialogs.startedProfilesSelections).toEqual(['channel-123:thread-1']);
      expect(interaction.editReply).toHaveBeenCalledWith({ content: menuText });
    });

    it('should publish the profile list in a direct message', async () => {
      const interaction = buildInteraction({ commandName: 'profiles', inGuild: false, channelId: 'dm-1', channel: null });

      await handler.handleInteraction(interaction);

      expect(dialogs.startedProfilesSelections).toEqual(['dm-1']);
      expect(interaction.editReply).toHaveBeenCalledWith({ content: menuText });
    });

    it('should refuse while questions wait for an answer', async () => {
      questions.pending = true;
      const interaction = buildInteraction({ commandName: 'profiles', inGuild: false, channelId: 'dm-1', channel: null });

      await handler.handleInteraction(interaction);

      expect(dialogs.startedProfilesSelections).toEqual([]);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    });

    it('should report failures starting the profile configuration', async () => {
      dialogs.throwError = true;
      const interaction = buildInteraction({ commandName: 'profiles', inGuild: false, channel: null });

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ **Failed to open profile selection**: profiles down',
      });
    });
  });

  describe('/squad', () => {
    const menuText = '👥 **Choose the squad to apply** by replying with the option number, or 0 to cancel:\n**1.** Backend team — 2 roles · Claude Code (default)';

    const guildChannelInteraction = (startThread: ReturnType<typeof rs.fn>) => buildInteraction({
      commandName: 'squad',
      editReply: rs.fn().mockResolvedValue({ startThread }),
    });

    it('should open the squad list in a new thread when used in a guild channel', async () => {
      const thread = { id: 'squad-thread', send: rs.fn().mockResolvedValue(undefined) };
      const startThread = rs.fn().mockResolvedValue(thread);
      const interaction = guildChannelInteraction(startThread);

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({ content: '🧵 Choose the squad in the thread below.' });
      expect(startThread).toHaveBeenCalledWith({ name: 'Squad selection', autoArchiveDuration: 60 });
      expect(dialogs.startedSquadSelections).toEqual(['channel-123:squad-thread']);
      expect(thread.send).toHaveBeenCalledWith(menuText);
    });

    it('should explain that there is no squad to apply', async () => {
      dialogs.squadSelectionResult = { kind: 'unavailable' };
      const interaction = buildInteraction({ commandName: 'squad', inGuild: false, channelId: 'dm-1', channel: null });

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({ content: 'ℹ️ No squads to apply. Create one in the web interface.' });
    });

    it('should refuse while questions wait for an answer', async () => {
      questions.pending = true;
      const interaction = buildInteraction({ commandName: 'squad', inGuild: false, channelId: 'dm-1', channel: null });

      await handler.handleInteraction(interaction);

      expect(dialogs.startedSquadSelections).toEqual([]);
      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❓ There are questions waiting for your answer in this conversation. Answer them or use /cancel before switching agent, model, squad, language or login.',
        ephemeral: true,
      });
    });

    it('should report failures starting the squad selection', async () => {
      dialogs.throwError = true;
      const interaction = buildInteraction({ commandName: 'squad', inGuild: false, channel: null });

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({ content: '❌ **Failed to open squad selection**: squads down' });
    });
  });

  describe('/language', () => {
    const requestText = '🌐 **Current language**: English\nReply with the language the agents should use to talk to you, such as "Spanish" or "Português".';

    it('should ask for the language in a new thread when used in a guild channel', async () => {
      const thread = { id: 'language-thread', send: rs.fn().mockResolvedValue(undefined) };
      const startThread = rs.fn().mockResolvedValue(thread);
      const interaction = buildInteraction({
        commandName: 'language',
        editReply: rs.fn().mockResolvedValue({ startThread }),
      });

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({ content: '🧵 Choose the language in the thread below.' });
      expect(startThread).toHaveBeenCalledWith({ name: 'Language selection', autoArchiveDuration: 60 });
      expect(dialogs.languageRequests).toEqual(['channel-123:language-thread']);
      expect(thread.send).toHaveBeenCalledWith(requestText);
    });

    it('should ask for the language in a direct message', async () => {
      const interaction = buildInteraction({ commandName: 'language', inGuild: false, channelId: 'dm-1', channel: null });

      await handler.handleInteraction(interaction);

      expect(dialogs.languageRequests).toEqual(['dm-1']);
      expect(interaction.editReply).toHaveBeenCalledWith({ content: requestText });
    });

    it('should refuse while questions wait for an answer', async () => {
      questions.pending = true;
      const interaction = buildInteraction({ commandName: 'language', inGuild: false, channelId: 'dm-1', channel: null });

      await handler.handleInteraction(interaction);

      expect(dialogs.languageRequests).toEqual([]);
      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❓ There are questions waiting for your answer in this conversation. Answer them or use /cancel before switching agent, model, squad, language or login.',
        ephemeral: true,
      });
    });

    it('should report failures requesting the language', async () => {
      dialogs.throwError = true;
      const interaction = buildInteraction({ commandName: 'language', inGuild: false, channel: null });

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ **Failed to open language selection**: preferences down',
      });
    });
  });

  describe('/agent-auth', () => {
    const menuText = [
      '🔑 **Choose the agent to log in** by replying with the option number, or 0 to cancel:',
      '**1.** Claude Code — ✅ logged in (me@example.com)',
      '**2.** OpenAI Codex — ⚠️ not logged in',
    ].join('\n');

    it('should list the agents in a new thread when used in a guild channel', async () => {
      const thread = { id: 'login-thread', send: rs.fn().mockResolvedValue(undefined) };
      const startThread = rs.fn().mockResolvedValue(thread);
      const interaction = buildInteraction({
        commandName: 'agent-auth',
        editReply: rs.fn().mockResolvedValue({ startThread }),
      });

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({ content: '🧵 Choose the agent to log in in the thread below.' });
      expect(startThread).toHaveBeenCalledWith({ name: 'Agent login', autoArchiveDuration: 60 });
      expect(dialogs.startedAgentAuthSelections).toEqual(['channel-123:login-thread']);
      expect(thread.send).toHaveBeenCalledWith(menuText);
    });

    it('should list the agents in a direct message', async () => {
      const interaction = buildInteraction({ commandName: 'agent-auth', inGuild: false, channelId: 'dm-1', channel: null });

      await handler.handleInteraction(interaction);

      expect(dialogs.startedAgentAuthSelections).toEqual(['dm-1']);
      expect(interaction.editReply).toHaveBeenCalledWith({ content: menuText });
    });

    it('should say so when no agent has a CLI login', async () => {
      dialogs.agentAuthSelectionResult = { kind: 'unavailable' };
      const interaction = buildInteraction({ commandName: 'agent-auth', inGuild: false, channelId: 'dm-1', channel: null });

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({ content: 'ℹ️ No agents with a CLI login are available.' });
    });

    it('should refuse while questions wait for an answer', async () => {
      questions.pending = true;
      const interaction = buildInteraction({ commandName: 'agent-auth', inGuild: false, channelId: 'dm-1', channel: null });

      await handler.handleInteraction(interaction);

      expect(dialogs.startedAgentAuthSelections).toEqual([]);
      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❓ There are questions waiting for your answer in this conversation. Answer them or use /cancel before switching agent, model, squad, language or login.',
        ephemeral: true,
      });
    });

    it('should report failures listing the agents', async () => {
      dialogs.throwError = true;
      const interaction = buildInteraction({ commandName: 'agent-auth', inGuild: false, channel: null });

      await handler.handleInteraction(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ **Failed to open login selection**: auth down',
      });
    });

    it('should confirm when only a login was cancelled by /cancel', async () => {
      agentTurn.cancelResult = false;
      dialogs.pendingAgentAuth = true;
      const interaction = buildInteraction({ commandName: 'cancel' });

      await handler.handleInteraction(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({ content: '🛑 **Selection cancelled.**', ephemeral: true });
    });
  });
});
