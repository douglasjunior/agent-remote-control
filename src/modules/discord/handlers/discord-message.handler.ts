import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Events, type Message, type ThreadChannel } from 'discord.js';

import type { AgentActivity } from '../../agent/ports/agent.port.js';
import { OrchestratorService } from '../../orchestrator/services/orchestrator.service.js';
import { DiscordActivityFormatter } from '../formatters/discord-activity.formatter.js';
import { DiscordClientService } from '../services/discord-client.service.js';
import { DiscordThrottler } from '../utils/discord-throttler.util.js';


@Injectable()
export class DiscordMessageHandler implements OnModuleInit {
  private readonly logger = new Logger(DiscordMessageHandler.name);

  constructor(
    private readonly discordClientService: DiscordClientService,
    private readonly orchestratorService: OrchestratorService,
    private readonly activityFormatter: DiscordActivityFormatter,
  ) {}

  onModuleInit(): void {
    this.discordClientService
      .getClient()
      .on(Events.MessageCreate, (message) => {
        void this.handleMessage(message);
      });
  }

  async handleMessage(message: Message): Promise<void> {
    if (message.author?.bot) {
      return;
    }

    const clientUser = this.discordClientService.getClient().user;
    if (!clientUser) {
      return;
    }

    const isDirectMessage =
      typeof message.channel?.isDMBased === 'function'
      && message.channel.isDMBased();
    const isThread =
      typeof message.channel?.isThread === 'function'
      && message.channel.isThread();
    const isBotMentioned = message.mentions.has(clientUser);
    const isManagedThread =
      isThread && (message.channel.ownerId === clientUser.id || isBotMentioned);

    if (!isDirectMessage && !isManagedThread && !isBotMentioned) {
      return;
    }

    let targetChannel: { send: (content: any) => Promise<any> } | null = null;
    let thread: ThreadChannel | null = null;

    try {
      let channelId: string;
      let threadId: string | undefined;

      if (isDirectMessage) {
        if (
          !('send' in message.channel)
          || typeof message.channel.send !== 'function'
        ) {
          return;
        }
        channelId = message.channelId;
        threadId = undefined;
        targetChannel =
          message.channel as unknown as { send: (content: any) => Promise<any> };
      } else if (isThread) {
        thread = message.channel as ThreadChannel;
        channelId = thread.parentId ?? thread.id;
        threadId = thread.id;
        targetChannel = thread;
      } else {
        const threadTitle =
          message.cleanContent.slice(0, 50).trim() || 'Agent Session';
        thread = await message.startThread({
          name: threadTitle,
          autoArchiveDuration: 60,
        });
        channelId = message.channelId;
        threadId = thread.id;
        targetChannel = thread;
      }

      const prompt = isDirectMessage
        ? message.content.trim()
        : this.cleanPrompt(message.content, clientUser.id);
      if (!prompt) {
        await targetChannel.send(
          'Olá! Como posso te ajudar hoje? Por favor, envie uma instrução ou tarefa.',
        );
        return;
      }

      const progressMessage = await targetChannel.send(
        '⏳ *Iniciando processamento...*',
      );
      const activities: string[] = [];
      const throttler = new DiscordThrottler({ intervalMs: 1500 });

      const onActivity = (activity: AgentActivity): void => {
        const formatted = this.activityFormatter.formatActivity(activity);
        if (formatted) {
          activities.push(formatted);
          throttler.schedule(async () => {
            try {
              const content = this.formatProgressContent(activities);
              await progressMessage.edit(content);
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              this.logger.warn(`Failed to update progress message: ${message}`);
            }
          });
        }
      };

      const result = await this.orchestratorService.executeTurn({
        channelId,
        threadId,
        userId: message.author.id,
        prompt,
        workspacePath: process.env.WORKSPACE_PATH || process.cwd(),
        agentRole: 'CEO',
        onActivity,
      });

      await throttler.flush();
      throttler.destroy();

      if (result.status === 'completed') {
        const chunks = this.activityFormatter.splitMessage(result.response);
        if (chunks.length === 0) {
          await targetChannel.send(
            '✅ *Tarefa concluída sem mensagem de resposta.*',
          );
        } else {
          for (const chunk of chunks) {
            await targetChannel.send(chunk);
          }
        }
      } else if (result.status === 'cancelled') {
        await targetChannel.send('⚠️ **Turno cancelado pelo usuário.**');
      } else {
        await targetChannel.send(
          `❌ **Erro na execução**: ${result.errorMessage || 'Falha desconhecida.'}`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error processing Discord message: ${errorMessage}`);
      if (targetChannel) {
        await targetChannel
          .send(
            `❌ **Ocorreu um erro ao processar sua solicitação:** ${errorMessage}`,
          )
          .catch(() => undefined);
      }
    }
  }

  private cleanPrompt(content: string, botId: string): string {
    const mentionRegex = new RegExp(`<@!?${botId}>`, 'g');
    return content.replace(mentionRegex, '').trim();
  }

  private formatProgressContent(activities: readonly string[]): string {
    const recent = activities.slice(-8).join('\n');
    return `🤖 **Progresso do Agente**:\n${recent}`;
  }
}
