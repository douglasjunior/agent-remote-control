import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type ChatInputCommandInteraction,
  Events,
  type Interaction,
} from 'discord.js';

import { OrchestratorService } from '../../orchestrator/services/orchestrator.service.js';
import { DiscordActivityFormatter } from '../formatters/discord-activity.formatter.js';
import { DiscordClientService } from '../services/discord-client.service.js';
import { type ConversationKey, resolveConversationKey } from '../utils/conversation-key.util.js';


type SelectionTarget = ConversationKey & { readonly publish: (content: string) => Promise<void> };

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
      await this.handleModelCommand(interaction);
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

  private async handleModelCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    try {
      await interaction.deferReply();
      const target = await this.openSelectionTarget(interaction);
      this.logCommand(interaction, target.channelId, target.threadId);

      const result = await this.orchestratorService.startConfigSelection(target.channelId, target.threadId);

      await target.publish(
        result.kind === 'selection'
          ? this.activityFormatter.formatSelection(result.selection)
          : 'ℹ️ O agente atual não expõe modelos para seleção.',
      );
    } catch (error) {
      const errorMessage = this.describeError(error);
      this.logger.error(`Error executing /model command: ${errorMessage}`);
      await this.respond(interaction, `❌ **Falha ao abrir a seleção de modelo**: ${errorMessage}`, false);
    }
  }

  /**
   * In a guild channel the options go to a new bot-owned thread, so answers without a mention
   * stay inside that thread instead of capturing every message of the channel.
   */
  private async openSelectionTarget(interaction: ChatInputCommandInteraction): Promise<SelectionTarget> {
    if (!interaction.inGuild() || interaction.channel?.isThread()) {
      return {
        ...resolveConversationKey(interaction.channelId, interaction.channel),
        publish: content => this.respond(interaction, content, false),
      };
    }

    const notice = await interaction.editReply({ content: '🧵 Escolha o modelo na thread abaixo.' });
    const thread = await notice.startThread({ name: 'Seleção de modelo', autoArchiveDuration: 60 });
    return {
      channelId: interaction.channelId,
      threadId: thread.id,
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
      return '🛑 **Seleção de modelo cancelada.**';
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
