import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type ChatInputCommandInteraction,
  Events,
  type Interaction,
  type ThreadChannel,
} from 'discord.js';

import { OrchestratorService } from '../../orchestrator/services/orchestrator.service.js';
import { DiscordClientService } from '../services/discord-client.service.js';


@Injectable()
export class DiscordInteractionHandler implements OnModuleInit {
  private readonly logger = new Logger(DiscordInteractionHandler.name);

  constructor(
    private readonly discordClientService: DiscordClientService,
    private readonly orchestratorService: OrchestratorService,
  ) {}

  onModuleInit(): void {
    this.discordClientService
      .getClient()
      .on(Events.InteractionCreate, (interaction) => {
        void this.handleInteraction(interaction);
      });
  }

  async handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.commandName === 'cancel') {
      await this.handleCancelCommand(interaction);
    }
  }

  private async handleCancelCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    try {
      const isThread = interaction.channel?.isThread();
      const channelId = isThread
        ? ((interaction.channel as ThreadChannel).parentId
          ?? interaction.channelId)
        : interaction.channelId;
      const threadId = isThread ? interaction.channelId : undefined;

      const username = interaction.user?.username ?? 'user';
      const userId = interaction.user?.id ?? 'unknown';

      this.logger.log(
        `[Slash Command] /cancel received from @${username} (${userId}) in channel=${channelId}, thread=${threadId ?? 'none'}`,
      );

      await this.orchestratorService.cancelTurn(channelId, threadId);

      this.logger.log(
        `[Slash Command] /cancel signal dispatched for channel=${channelId}`,
      );

      const replyContent =
        '🛑 **Cancelamento solicitado.** O turno ativo será interrompido.';

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: replyContent, ephemeral: true });
      } else {
        await interaction.reply({ content: replyContent, ephemeral: true });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error executing /cancel command: ${errorMessage}`);

      const failureContent = `❌ **Falha ao solicitar cancelamento**: ${errorMessage}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: failureContent,
          ephemeral: true,
        });
      } else {
        await interaction.reply({ content: failureContent, ephemeral: true });
      }
    }
  }
}
