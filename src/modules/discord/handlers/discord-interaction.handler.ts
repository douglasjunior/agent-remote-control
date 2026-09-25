import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type ChatInputCommandInteraction,
  Events,
  type Interaction,
  type ThreadChannel,
} from 'discord.js';

import { OrchestratorService } from '../../orchestrator/services/orchestrator.service.js';
import { DiscordActivityFormatter } from '../formatters/discord-activity.formatter.js';
import { DiscordClientService } from '../services/discord-client.service.js';


type ConversationKey = { readonly channelId: string; readonly threadId?: string };

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
      const { channelId, threadId } = this.resolveConversation(interaction);
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
      const { channelId, threadId } = this.resolveConversation(interaction);
      this.logCommand(interaction, channelId, threadId);

      await interaction.deferReply();
      const result = await this.orchestratorService.startConfigSelection(channelId, threadId);

      await this.respond(
        interaction,
        result.kind === 'selection'
          ? this.activityFormatter.formatSelection(result.selection)
          : 'ℹ️ O agente atual não expõe modelos para seleção.',
        false,
      );
    } catch (error) {
      const errorMessage = this.describeError(error);
      this.logger.error(`Error executing /model command: ${errorMessage}`);
      await this.respond(interaction, `❌ **Falha ao listar os modelos**: ${errorMessage}`, false);
    }
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

  private resolveConversation(interaction: ChatInputCommandInteraction): ConversationKey {
    if (!interaction.channel?.isThread()) {
      return { channelId: interaction.channelId };
    }
    return {
      channelId: (interaction.channel as ThreadChannel).parentId ?? interaction.channelId,
      threadId: interaction.channelId,
    };
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
