import { Injectable, Logger, Inject, type OnModuleInit } from '@nestjs/common';
import { type ClientUser, Events, type Message } from 'discord.js';

import type { AgentActivity } from '../../agent/ports/agent.port.js';
import type { DelegationEvent } from '../../orchestrator/models/delegation-event.model.js';
import type { TurnAttachment } from '../../orchestrator/models/turn-attachment.model.js';
import type { TurnResult } from '../../orchestrator/models/turn-result.model.js';
import { OrchestratorService } from '../../orchestrator/services/orchestrator.service.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import { DiscordActivityFormatter } from '../formatters/discord-activity.formatter.js';
import { DiscordAttachmentService } from '../services/discord-attachment.service.js';
import { DiscordClientService } from '../services/discord-client.service.js';
import { type ConversationKey, resolveConversationKey } from '../utils/conversation-key.util.js';
import { DiscordThrottler } from '../utils/discord-throttler.util.js';
import { DiscordTypingIndicator } from '../utils/discord-typing-indicator.util.js';


const DISCORD_MESSAGE_LIMIT = 2000;
const DEFAULT_ATTACHMENT_PROMPT = 'O usuário enviou anexos. Analise os arquivos anexados.';

type SendableChannel = {
  send: (options: string | { content?: string; files?: string[] }) => Promise<any>;
  sendTyping?: () => Promise<unknown>;
};

type Conversation = ConversationKey & { readonly target: SendableChannel };

type ProgressMessage = {
  edit: (content: string) => Promise<unknown>;
  delete?: () => Promise<unknown>;
};

type ThoughtTracker = {
  messages: any[];
  currentText: string;
};

@Injectable()
export class DiscordMessageHandler implements OnModuleInit {
  private readonly logger = new Logger(DiscordMessageHandler.name);

  constructor(
    private readonly discordClientService: DiscordClientService,
    private readonly orchestratorService: OrchestratorService,
    private readonly activityFormatter: DiscordActivityFormatter,
    private readonly attachmentService: DiscordAttachmentService,
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
      const attachments = message.attachments ? Array.from(message.attachments.values()) : [];
      const hasAttachments = attachments.length > 0;
      const authorName = message.author?.username ?? 'user';
      const authorId = message.author?.id ?? 'unknown';

      if (!rawPrompt && !hasAttachments) {
        this.logger.log(
          `[Empty Prompt] Received empty message from @${authorName} in channel=${channelId}, thread=${threadId ?? 'none'}`,
        );
        await targetChannel.send(
          'Olá! Como posso te ajudar hoje? Por favor, envie uma instrução ou tarefa.',
        );
        return;
      }

      let turnAttachments: TurnAttachment[] | undefined;
      if (hasAttachments) {
        const validation = this.attachmentService.validateAttachments(attachments);
        if (!validation.valid) {
          await targetChannel.send(validation.reason);
          return;
        }

        const conversationKey = `${channelId}${threadId ? `:${threadId}` : ''}`;
        turnAttachments = await this.attachmentService.downloadAttachments(
          conversationKey,
          attachments,
        );
      }

      const promptText = rawPrompt || DEFAULT_ATTACHMENT_PROMPT;

      this.logger.log(
        `[Message Received] From @${authorName} (${authorId}) in channel=${channelId}, thread=${threadId ?? 'none'}: "${promptText.slice(0, 100)}${promptText.length > 100 ? '...' : ''}"${hasAttachments ? ` (${attachments.length} attachment(s))` : ''}`,
      );

      const resolution = await this.orchestratorService.resolveInput({
        channelId,
        threadId,
        prompt: promptText,
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

      const progressMessage: ProgressMessage = await targetChannel.send(
        '⏳ *Iniciando processamento...*',
      );
      let initialProgressCleaned = false;
      const cleanInitialProgress = async (): Promise<void> => {
        if (initialProgressCleaned) {
          return;
        }
        initialProgressCleaned = true;
        await progressMessage.delete?.().catch(() => undefined);
      };

      const throttler = new DiscordThrottler({ intervalMs: 1500 });
      const toolMessages = new Map<string, Promise<any>>();
      const thoughtTrackers = new Map<string, ThoughtTracker>();
      let delegationChain = Promise.resolve();

      const typing = new DiscordTypingIndicator(targetChannel);
      typing.start();

      const onActivity = (activity: AgentActivity): void => {
        typing.keepAlive();
        void cleanInitialProgress();

        if (activity.kind === 'thought') {
          if (activity.final) {
            this.logger.log(`💭 [Agent Thought] ${activity.text.trim()}`);
          }

          if (activity.removed) {
            const tracker = thoughtTrackers.get(activity.id);
            if (tracker) {
              thoughtTrackers.delete(activity.id);
              for (const msg of tracker.messages) {
                if (typeof msg?.delete === 'function') {
                  void msg.delete().catch(() => undefined);
                }
              }
            }
            return;
          }

          const formatted = this.activityFormatter.formatActivity(activity);
          if (!formatted) {
            return;
          }

          let tracker = thoughtTrackers.get(activity.id);
          if (!tracker) {
            tracker = { messages: [], currentText: '' };
            thoughtTrackers.set(activity.id, tracker);
          }
          tracker.currentText = formatted;

          throttler.schedule(async () => {
            await this.syncThoughtMessages(thoughtTrackers, targetChannel!);
          });
          return;
        }

        if (activity.kind === 'tool') {
          this.logger.log(
            `🔧 [Tool Call: ${activity.status}] ${activity.title} (callId: ${activity.toolCallId})`,
          );

          const formatted = this.activityFormatter.formatActivity(activity);
          if (!formatted) {
            return;
          }

          if (activity.status === 'in_progress') {
            const sendPromise = targetChannel!.send(formatted).catch((error: unknown) => {
              this.logger.warn(`Failed to send tool call message: ${this.describeError(error)}`);
              return null;
            });
            toolMessages.set(activity.toolCallId, sendPromise);
            return;
          }

          if (activity.status === 'completed' || activity.status === 'failed') {
            const prevPromise = toolMessages.get(activity.toolCallId);
            const editPromise = (prevPromise ?? Promise.resolve(null))
              .then(async (msg) => {
                if (msg && typeof msg.edit === 'function') {
                  await msg.edit(formatted);
                  return msg;
                }
                return await targetChannel!.send(formatted);
              })
              .catch((error: unknown) => {
                this.logger.warn(`Failed to update tool call message: ${this.describeError(error)}`);
                return null;
              });
            toolMessages.set(activity.toolCallId, editPromise);
          }
        }
      };

      const onDelegation = (event: DelegationEvent): void => {
        typing.keepAlive();
        void cleanInitialProgress();

        delegationChain = delegationChain.then(async () => {
          await throttler.flush();
          try {
            if (event.phase === 'finished' && event.response.trim()) {
              await this.sendChunks(
                targetChannel!,
                this.activityFormatter.formatDelegateResult(event),
                this.activityFormatter.formatDelegateFooter(event),
              );
            }
            await targetChannel!.send(this.activityFormatter.formatDelegation(event));
          } catch (error) {
            this.logger.warn(`Failed to announce the delegation: ${this.describeError(error)}`);
          }
        });
      };

      let result: TurnResult;
      try {
        result = await this.orchestratorService.executeTurn({
          channelId,
          threadId,
          userId: message.author.id,
          prompt,
          workspacePath: this.workspacePort.getBaseDirectory(),
          agentRole: 'CEO',
          ...(turnAttachments && turnAttachments.length > 0 ? { attachments: turnAttachments } : {}),
          onActivity,
          onDelegation,
          onQueued: () => {
            void progressMessage
              .edit('⏳ *Aguardando a tarefa anterior desta conversa terminar...*')
              .catch(() => undefined);
          },
        });
      } finally {
        typing.stop();
      }

      await cleanInitialProgress();
      await delegationChain;
      await throttler.flush();
      throttler.destroy();
      await Promise.all(Array.from(toolMessages.values()).map(p => p.catch(() => undefined)));

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

  private async syncThoughtMessages(
    thoughtTrackers: Map<string, ThoughtTracker>,
    targetChannel: SendableChannel,
  ): Promise<void> {
    for (const tracker of thoughtTrackers.values()) {
      const chunks = this.activityFormatter.splitMessage(
        tracker.currentText,
        DISCORD_MESSAGE_LIMIT,
      );
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        if (tracker.messages[i]) {
          if (
            tracker.messages[i].content !== chunk
            && typeof tracker.messages[i].edit === 'function'
          ) {
            try {
              await tracker.messages[i].edit(chunk);
              tracker.messages[i].content = chunk;
            } catch (error) {
              this.logger.warn(`Failed to update thought message: ${this.describeError(error)}`);
            }
          }
        } else {
          try {
            const sent = await targetChannel.send(chunk);
            if (sent) {
              sent.content ??= chunk;
              tracker.messages.push(sent);
            }
          } catch (error) {
            this.logger.warn(`Failed to send thought message: ${this.describeError(error)}`);
          }
        }
      }
    }
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
      ? this.activityFormatter.formatAgentFooter(result.agentInfo, result.usage)
      : '';

    if (result.status === 'completed') {
      this.logger.log(
        `[Response Sent] Turn completed for session ${result.sessionId}. Length: ${result.response.length} chars`,
      );
      await this.sendChunks(
        targetChannel,
        result.response || '✅ *Tarefa concluída sem mensagem de resposta.*',
        footer,
        result.attachments,
      );
      return;
    }

    if (result.status === 'cancelled') {
      this.logger.warn(
        `[Turn Cancelled] Active turn was cancelled for session ${result.sessionId}`,
      );
      await this.sendChunks(targetChannel, '⚠️ **Turno cancelado pelo usuário.**', footer, result.attachments);
      return;
    }

    this.logger.error(
      `[Turn Failed] Turn execution failed for session ${result.sessionId ?? 'none'}: ${result.errorMessage}`,
    );
    await this.sendChunks(
      targetChannel,
      `❌ **Erro na execução**: ${result.errorMessage || 'Falha desconhecida.'}`,
      footer,
      result.attachments,
    );
  }

  private async sendChunks(
    targetChannel: SendableChannel,
    content: string,
    footer = '',
    attachments?: readonly string[],
  ): Promise<void> {
    const limit = footer ? DISCORD_MESSAGE_LIMIT - footer.length - 1 : DISCORD_MESSAGE_LIMIT;
    const chunks = this.activityFormatter.splitMessage(content, limit);
    for (const [index, chunk] of chunks.entries()) {
      const isLast = index === chunks.length - 1;
      const messageContent = isLast && footer ? `${chunk}\n${footer}` : chunk;

      if (isLast && attachments && attachments.length > 0) {
        try {
          await targetChannel.send({ content: messageContent, files: [...attachments] });
        } catch (error) {
          this.logger.warn(
            `[Attachment Fallback] Failed to send attachments, falling back to text only: ${String(error)}`,
          );
          await targetChannel.send(messageContent);
        }
      } else {
        await targetChannel.send(messageContent);
      }
    }
  }

  private cleanPrompt(content: string, botId: string): string {
    const mentionRegex = new RegExp(`<@!?${botId}>`, 'g');
    return content.replace(mentionRegex, '').trim();
  }
}
