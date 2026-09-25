import { Injectable, Logger, Inject, type OnModuleInit } from '@nestjs/common';
import { Events, type Message, type ThreadChannel } from 'discord.js';

import type { AgentActivity } from '../../agent/ports/agent.port.js';
import type { TurnResult } from '../../orchestrator/models/turn-result.model.js';
import { OrchestratorService } from '../../orchestrator/services/orchestrator.service.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import { DiscordActivityFormatter } from '../formatters/discord-activity.formatter.js';
import { DiscordClientService } from '../services/discord-client.service.js';
import { ActivityFeed } from '../utils/activity-feed.util.js';
import { DiscordThrottler } from '../utils/discord-throttler.util.js';


const PROGRESS_HEADER = '🤖 **Progresso do Agente**:\n';
const DISCORD_MESSAGE_LIMIT = 2000;

type SendableChannel = { send: (content: any) => Promise<any> };

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
    if (!clientUser) {
      return;
    }

    const isDirectMessage =
      typeof message.channel?.isDMBased === 'function'
      && message.channel.isDMBased();
    const isThread =
      typeof message.channel?.isThread === 'function'
      && message.channel.isThread();
    const isBotMentioned = message.mentions.has(clientUser, {
      ignoreEveryone: true,
      ignoreRoles: true,
    });
    const isManagedThread =
      isThread && (message.channel.ownerId === clientUser.id || isBotMentioned);

    const isChannelSelectionAnswer =
      !isDirectMessage
      && !isManagedThread
      && !isBotMentioned
      && (await this.orchestratorService.hasActiveConfigSelection(message.channelId));

    if (!isDirectMessage && !isManagedThread && !isBotMentioned && !isChannelSelectionAnswer) {
      return;
    }

    let targetChannel: SendableChannel | null = null;
    let thread: ThreadChannel | null = null;

    try {
      let channelId: string;
      let threadId: string | undefined;

      if (isDirectMessage || isChannelSelectionAnswer) {
        if (
          !('send' in message.channel)
          || typeof message.channel.send !== 'function'
        ) {
          return;
        }
        channelId = message.channelId;
        threadId = undefined;
        targetChannel = message.channel as unknown as SendableChannel;
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

      const rawPrompt = isDirectMessage || isChannelSelectionAnswer
        ? message.content.trim()
        : this.cleanPrompt(message.content, clientUser.id);
      const authorName = message.author?.username ?? 'user';
      const authorId = message.author?.id ?? 'unknown';

      if (!rawPrompt) {
        this.logger.log(
          `[Empty Prompt] Received empty message from @${authorName} in ${isDirectMessage ? 'DM' : 'Channel'} ${message.channelId}`,
        );
        await targetChannel.send(
          'Olá! Como posso te ajudar hoje? Por favor, envie uma instrução ou tarefa.',
        );
        return;
      }

      this.logger.log(
        `[Message Received] From @${authorName} (${authorId}) in ${isDirectMessage ? 'DM' : 'Channel'} (${channelId}): "${rawPrompt.slice(0, 100)}${rawPrompt.length > 100 ? '...' : ''}"`,
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
        await targetChannel
          .send(
            `❌ **Ocorreu um erro ao processar sua solicitação:** ${errorMessage}`,
          )
          .catch(() => undefined);
      }
    }
  }

  private async sendTurnResult(targetChannel: SendableChannel, result: TurnResult): Promise<void> {
    const footer = result.agentInfo
      ? this.activityFormatter.formatAgentFooter(result.agentInfo)
      : '';
    const withFooter = (text: string): string => (footer ? `${text}\n${footer}` : text);

    if (result.status === 'completed') {
      const chunks = this.activityFormatter.splitMessage(
        result.response,
        footer ? DISCORD_MESSAGE_LIMIT - footer.length - 1 : DISCORD_MESSAGE_LIMIT,
      );
      this.logger.log(
        `[Response Sent] Turn completed for session ${result.sessionId}. Length: ${result.response.length} chars, Chunks: ${chunks.length}`,
      );
      if (chunks.length === 0) {
        await targetChannel.send(withFooter('✅ *Tarefa concluída sem mensagem de resposta.*'));
        return;
      }
      for (const [index, chunk] of chunks.entries()) {
        await targetChannel.send(index === chunks.length - 1 ? withFooter(chunk) : chunk);
      }
      return;
    }

    if (result.status === 'cancelled') {
      this.logger.warn(
        `[Turn Cancelled] Active turn was cancelled for session ${result.sessionId}`,
      );
      await targetChannel.send(withFooter('⚠️ **Turno cancelado pelo usuário.**'));
      return;
    }

    this.logger.error(
      `[Turn Failed] Turn execution failed for session ${result.sessionId}: ${result.errorMessage}`,
    );
    await targetChannel.send(
      withFooter(`❌ **Erro na execução**: ${result.errorMessage || 'Falha desconhecida.'}`),
    );
  }

  private async sendChunks(targetChannel: SendableChannel, content: string): Promise<void> {
    for (const chunk of this.activityFormatter.splitMessage(content)) {
      await targetChannel.send(chunk);
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
