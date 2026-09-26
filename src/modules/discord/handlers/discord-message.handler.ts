import { Injectable, Logger, Inject, type OnModuleInit } from '@nestjs/common';
import { type ClientUser, Events, type Message } from 'discord.js';

import type { AgentActivity } from '../../agent/ports/agent.port.js';
import type { TurnResult } from '../../orchestrator/models/turn-result.model.js';
import { OrchestratorService } from '../../orchestrator/services/orchestrator.service.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import { DiscordActivityFormatter } from '../formatters/discord-activity.formatter.js';
import { DiscordClientService } from '../services/discord-client.service.js';
import { ActivityFeed } from '../utils/activity-feed.util.js';
import { type ConversationKey, resolveConversationKey } from '../utils/conversation-key.util.js';
import { DiscordThrottler } from '../utils/discord-throttler.util.js';


const PROGRESS_HEADER = '🤖 **Progresso do Agente**:\n';
const DISCORD_MESSAGE_LIMIT = 2000;

type SendableChannel = { send: (content: any) => Promise<any> };

type Conversation = ConversationKey & { readonly target: SendableChannel };

@Injectable()
export class DiscordMessageHandler implements OnModuleInit {
  private readonly logger = new Logger(DiscordMessageHandler.name);

  constructor(
    private readonly discordClientService: DiscordClientService,
    private readonly orchestratorService: OrchestratorService,
    private readonly activityFormatter: DiscordActivityFormatter,
    @Inject(IWorkspacePort)
    private readonly workspacePort: IWorkspacePort,
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
    if (!clientUser || !(await this.acceptsMessage(message, clientUser))) {
      return;
    }

    let targetChannel: SendableChannel | null = null;

    try {
      const conversation = await this.openConversation(message);
      if (!conversation) {
        return;
      }
      const { channelId, threadId } = conversation;
      targetChannel = conversation.target;

      const rawPrompt = this.cleanPrompt(message.content, clientUser.id);
      const authorName = message.author?.username ?? 'user';
      const authorId = message.author?.id ?? 'unknown';

      if (!rawPrompt) {
        this.logger.log(
          `[Empty Prompt] Received empty message from @${authorName} in channel=${channelId}, thread=${threadId ?? 'none'}`,
        );
        await targetChannel.send(
          'Olá! Como posso te ajudar hoje? Por favor, envie uma instrução ou tarefa.',
        );
        return;
      }

      this.logger.log(
        `[Message Received] From @${authorName} (${authorId}) in channel=${channelId}, thread=${threadId ?? 'none'}: "${rawPrompt.slice(0, 100)}${rawPrompt.length > 100 ? '...' : ''}"`,
      );

      const resolution = await this.orchestratorService.resolveInput({
        channelId,
        threadId,
        prompt: rawPrompt,
      });

      if (resolution.kind === 'selection') {
        await this.sendChunks(targetChannel, this.activityFormatter.formatSelection(resolution.selection));
        return;
      }
      if (resolution.kind === 'invalid') {
        await this.sendChunks(targetChannel, this.activityFormatter.formatInvalidSelection(resolution.selection));
        return;
      }
      if (resolution.kind === 'configured') {
        await targetChannel.send(this.activityFormatter.formatConfigured(resolution.settings));
        return;
      }
      if (resolution.configured) {
        await targetChannel.send(this.activityFormatter.formatConfigured(resolution.configured));
      }
      const { prompt } = resolution;

      const progressMessage = await targetChannel.send(
        '⏳ *Iniciando processamento...*',
      );
      const feed = new ActivityFeed();
      const throttler = new DiscordThrottler({ intervalMs: 1500 });

      const onActivity = (activity: AgentActivity): void => {
        const key = this.activityKey(activity);
        if (!key) {
          return;
        }

        if (activity.kind === 'thought' && activity.final) {
          this.logger.log(`💭 [Agent Thought] ${activity.text.trim()}`);
        } else if (activity.kind === 'tool') {
          this.logger.log(
            `🔧 [Tool Call: ${activity.status}] ${activity.title} (callId: ${activity.toolCallId})`,
          );
        }

        const formatted = this.activityFormatter.formatActivity(activity);
        if (activity.kind === 'thought' && activity.removed) {
          feed.remove(key);
        } else if (formatted) {
          feed.upsert(key, formatted);
        } else {
          return;
        }

        throttler.schedule(async () => {
          try {
            await progressMessage.edit(feed.render(PROGRESS_HEADER));
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.warn(`Failed to update progress message: ${message}`);
          }
        });
      };

      const result = await this.orchestratorService.executeTurn({
        channelId,
        threadId,
        userId: message.author.id,
        prompt,
        workspacePath: this.workspacePort.getBaseDirectory(),
        agentRole: 'CEO',
        onActivity,
        onQueued: () => {
          void progressMessage
            .edit('⏳ *Aguardando a tarefa anterior desta conversa terminar...*')
            .catch(() => undefined);
        },
      });

      await throttler.flush();
      throttler.destroy();

      await this.sendTurnResult(targetChannel, result);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error processing Discord message: ${errorMessage}`);
      if (targetChannel) {
        await this.sendChunks(
          targetChannel,
          `❌ **Ocorreu um erro ao processar sua solicitação:** ${errorMessage}`,
        ).catch((sendError: unknown) => {
          this.logger.warn(`Failed to report the error to Discord: ${String(sendError)}`);
        });
      }
    }
  }

  private async acceptsMessage(message: Message, bot: ClientUser): Promise<boolean> {
    const isBotMentioned = message.mentions.has(bot, {
      ignoreEveryone: true,
      ignoreRoles: true,
    });
    if (isBotMentioned || message.channel?.isDMBased()) {
      return true;
    }
    if (!message.channel?.isThread()) {
      return false;
    }
    if (message.channel.ownerId === bot.id) {
      return true;
    }
    const { channelId, threadId } = resolveConversationKey(message.channelId, message.channel);
    return this.orchestratorService.hasActiveConfigSelection(channelId, threadId);
  }

  private async openConversation(message: Message): Promise<Conversation | null> {
    if (message.channel.isDMBased()) {
      if (!('send' in message.channel)) {
        return null;
      }
      return { channelId: message.channelId, target: message.channel };
    }
    if (message.channel.isThread()) {
      return { ...resolveConversationKey(message.channelId, message.channel), target: message.channel };
    }
    const thread = await message.startThread({
      name: message.cleanContent.slice(0, 50).trim() || 'Agent Session',
      autoArchiveDuration: 60,
    });
    return { channelId: message.channelId, threadId: thread.id, target: thread };
  }

  private async sendTurnResult(targetChannel: SendableChannel, result: TurnResult): Promise<void> {
    const footer = result.agentInfo
      ? this.activityFormatter.formatAgentFooter(result.agentInfo)
      : '';

    if (result.status === 'completed') {
      this.logger.log(
        `[Response Sent] Turn completed for session ${result.sessionId}. Length: ${result.response.length} chars`,
      );
      await this.sendChunks(
        targetChannel,
        result.response || '✅ *Tarefa concluída sem mensagem de resposta.*',
        footer,
      );
      return;
    }

    if (result.status === 'cancelled') {
      this.logger.warn(
        `[Turn Cancelled] Active turn was cancelled for session ${result.sessionId}`,
      );
      await this.sendChunks(targetChannel, '⚠️ **Turno cancelado pelo usuário.**', footer);
      return;
    }

    this.logger.error(
      `[Turn Failed] Turn execution failed for session ${result.sessionId ?? 'none'}: ${result.errorMessage}`,
    );
    await this.sendChunks(
      targetChannel,
      `❌ **Erro na execução**: ${result.errorMessage || 'Falha desconhecida.'}`,
      footer,
    );
  }

  private async sendChunks(targetChannel: SendableChannel, content: string, footer = ''): Promise<void> {
    const limit = footer ? DISCORD_MESSAGE_LIMIT - footer.length - 1 : DISCORD_MESSAGE_LIMIT;
    const chunks = this.activityFormatter.splitMessage(content, limit);
    for (const [index, chunk] of chunks.entries()) {
      const isLast = index === chunks.length - 1;
      await targetChannel.send(isLast && footer ? `${chunk}\n${footer}` : chunk);
    }
  }

  private cleanPrompt(content: string, botId: string): string {
    const mentionRegex = new RegExp(`<@!?${botId}>`, 'g');
    return content.replace(mentionRegex, '').trim();
  }

  private activityKey(activity: AgentActivity): string | null {
    if (activity.kind === 'thought') {
      return `thought:${activity.id}`;
    }
    if (activity.kind === 'tool') {
      return `tool:${activity.toolCallId}`;
    }
    return null;
  }
}
