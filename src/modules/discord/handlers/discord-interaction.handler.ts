import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type ChatInputCommandInteraction,
  Events,
  type Interaction,
} from 'discord.js';

import type { StartAgentConfigSelectionResult } from '../../orchestrator/models/agent-config-outcome.model.js';
import { OrchestratorService } from '../../orchestrator/services/orchestrator.service.js';
import { DiscordActivityFormatter } from '../formatters/discord-activity.formatter.js';
import { DiscordClientService } from '../services/discord-client.service.js';
import { type ConversationKey, resolveConversationKey } from '../utils/conversation-key.util.js';
import { DiscordTypingIndicator, type TypingChannel } from '../utils/discord-typing-indicator.util.js';


type SelectionTarget = ConversationKey & {
  readonly publish: (content: string) => Promise<void>;
  /** Present when nothing else signals progress: the deferred reply already shows "thinking". */
  readonly typingChannel?: TypingChannel;
};

type SelectionCommand = {
  readonly subject: string;
  readonly notice: string;
  readonly threadName: string;
  readonly unavailable: string;
  readonly start: (channelId: string, threadId?: string) => Promise<StartAgentConfigSelectionResult>;
};

@Injectable()
export class DiscordInteractionHandler implements OnModuleInit {
  private readonly logger = new Logger(DiscordInteractionHandler.name);

  constructor(
    private readonly discordClientService: DiscordClientService,
    private readonly orchestratorService: OrchestratorService,
    private readonly activityFormatter: DiscordActivityFormatter,
  ) {}

  onModuleInit(): void {
    this.discordClientService
      .getClient()
      .on(Events.InteractionCreate, (interaction) => {
        this.handleInteraction(interaction).catch((error: unknown) => {
          this.logger.error(`interaction_handler_failed: ${this.describeError(error)}`);
        });
      });
  }

  async handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.commandName === 'cancel') {
      await this.handleCancelCommand(interaction);
    } else if (interaction.commandName === 'model') {
      await this.handleSelectionCommand(interaction, {
        subject: 'modelo',
        notice: '🧵 Escolha o modelo na thread abaixo.',
        threadName: 'Seleção de modelo',
        unavailable: 'ℹ️ O agente atual não expõe modelos para seleção.',
        start: (channelId, threadId) => this.orchestratorService.startConfigSelection(channelId, threadId),
      });
    } else if (interaction.commandName === 'agent') {
      await this.handleSelectionCommand(interaction, {
        subject: 'agente',
        notice: '🧵 Escolha o agente na thread abaixo.',
        threadName: 'Seleção de agente',
        unavailable: 'ℹ️ Nenhum agente disponível para seleção.',
        start: (channelId, threadId) => this.orchestratorService.startAgentSelection(channelId, threadId),
      });
    }
  }

  private async handleCancelCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    try {
      const { channelId, threadId } = resolveConversationKey(interaction.channelId, interaction.channel);
      this.logCommand(interaction, channelId, threadId);

      const selectionCancelled = await this.orchestratorService.cancelConfigSelection(channelId, threadId);
      const turnCancelled = await this.orchestratorService.cancelTurn(channelId, threadId);

      this.logger.log(
        `[Slash Command] /cancel handled for channel=${channelId} (turn=${turnCancelled}, selection=${selectionCancelled})`,
      );

      await this.respond(interaction, this.cancelReply(turnCancelled, selectionCancelled), true);
    } catch (error) {
      const errorMessage = this.describeError(error);
      this.logger.error(`Error executing /cancel command: ${errorMessage}`);
      await this.respond(interaction, `❌ **Falha ao solicitar cancelamento**: ${errorMessage}`, true);
    }
  }

  private async handleSelectionCommand(
    interaction: ChatInputCommandInteraction,
    command: SelectionCommand,
  ): Promise<void> {
    try {
      await interaction.deferReply();
      const target = await this.openSelectionTarget(interaction, command);
      this.logCommand(interaction, target.channelId, target.threadId);

      const start = () => command.start(target.channelId, target.threadId);
      const result = target.typingChannel
        ? await DiscordTypingIndicator.during(target.typingChannel, start)
        : await start();

      await target.publish(
        result.kind === 'selection'
          ? this.activityFormatter.formatSelection(result.selection)
          : command.unavailable,
      );
    } catch (error) {
      const errorMessage = this.describeError(error);
      this.logger.error(`Error executing /${interaction.commandName} command: ${errorMessage}`);
      await this.respond(interaction, `❌ **Falha ao abrir a seleção de ${command.subject}**: ${errorMessage}`, false);
    }
  }

  /**
   * In a guild channel the options go to a new bot-owned thread, so answers without a mention
   * stay inside that thread instead of capturing every message of the channel.
   */
  private async openSelectionTarget(
    interaction: ChatInputCommandInteraction,
    command: SelectionCommand,
  ): Promise<SelectionTarget> {
    if (!interaction.inGuild() || interaction.channel?.isThread()) {
      return {
        ...resolveConversationKey(interaction.channelId, interaction.channel),
        publish: content => this.respond(interaction, content, false),
      };
    }

    const notice = await interaction.editReply({ content: command.notice });
    const thread = await notice.startThread({ name: command.threadName, autoArchiveDuration: 60 });
    return {
      channelId: interaction.channelId,
      threadId: thread.id,
      typingChannel: thread,
      publish: async (content) => {
        for (const chunk of this.activityFormatter.splitMessage(content)) {
          await thread.send(chunk);
        }
      },
    };
  }

  private cancelReply(turnCancelled: boolean, selectionCancelled: boolean): string {
    if (turnCancelled) {
      return '🛑 **Cancelamento solicitado.** O turno ativo será interrompido.';
    }
    if (selectionCancelled) {
      return '🛑 **Seleção cancelada.**';
    }
    return 'ℹ️ Não há nenhum turno em andamento para cancelar.';
  }

  private logCommand(
    interaction: ChatInputCommandInteraction,
    channelId: string,
    threadId: string | undefined,
  ): void {
    const username = interaction.user?.username ?? 'user';
    const userId = interaction.user?.id ?? 'unknown';
    this.logger.log(
      `[Slash Command] /${interaction.commandName} received from @${username} (${userId}) in channel=${channelId}, thread=${threadId ?? 'none'}`,
    );
  }

  private async respond(
    interaction: ChatInputCommandInteraction,
    content: string,
    ephemeral: boolean,
  ): Promise<void> {
    try {
      if (interaction.deferred) {
        await interaction.editReply({ content });
      } else if (interaction.replied) {
        await interaction.followUp({ content, ephemeral });
      } else {
        await interaction.reply({ content, ephemeral });
      }
    } catch (error) {
      this.logger.warn(`interaction_reply_failed (/${interaction.commandName}): ${this.describeError(error)}`);
    }
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
