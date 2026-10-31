import { Injectable, Logger, Inject, type OnModuleInit } from '@nestjs/common';
import { type ClientUser, Events, type Message } from 'discord.js';

import type { AgentActivity } from '../../agent/ports/agent.port.js';
import type { DelegationEvent } from '../../orchestrator/models/delegation-event.model.js';
import type { TurnAttachment } from '../../orchestrator/models/turn-attachment.model.js';
import type { TurnResult } from '../../orchestrator/models/turn-result.model.js';
import type { QuestionPrompt } from '../../orchestrator/models/user-question.model.js';
import { OrchestratorService } from '../../orchestrator/services/orchestrator.service.js';
import { IWorkspacePort } from '../../workspace/ports/workspace.port.js';
import { DiscordActivityFormatter } from '../formatters/discord-activity.formatter.js';
import { DiscordAttachmentService } from '../services/discord-attachment.service.js';
import { DiscordClientService } from '../services/discord-client.service.js';
import { buildConversationId, type ConversationKey, resolveConversationKey } from '../utils/conversation-key.util.js';
import { DiscordThrottler } from '../utils/discord-throttler.util.js';
import { DiscordTypingIndicator } from '../utils/discord-typing-indicator.util.js';


const DISCORD_MESSAGE_LIMIT = 2000;
const STEERED_NOTICE = '📨 *Message sent to the running agent. The reply will come with the current task\'s response.*';

type SendableChannel = {
  send: (options: string | { content?: string; files?: string[] }) => Promise<any>;
  sendTyping?: () => Promise<unknown>;
};

type Conversation = ConversationKey & { readonly target: SendableChannel };

type ProgressMessage = {
  edit: (content: string) => Promise<unknown>;
  delete?: () => Promise<void>;
};

type TrackedMessage = {
  content?: string;
  edit: (content: string) => Promise<unknown>;
  delete?: () => Promise<unknown>;
};

type ThoughtTracker = {
  messages: TrackedMessage[];
  currentText: string;
  isDeleted?: boolean;
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
      const conversationId = buildConversationId(conversation);
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
          'Hi! How can I help you today? Please send an instruction or task.',
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

        turnAttachments = await this.attachmentService.downloadAttachments(
          conversationId,
          attachments,
        );
      }

      this.logger.log(
        `[Message Received] From @${authorName} (${authorId}) in channel=${channelId}, thread=${threadId ?? 'none'}: "${rawPrompt.slice(0, 100)}${rawPrompt.length > 100 ? '...' : ''}"${hasAttachments ? ` (${attachments.length} attachment(s))` : ''}`,
      );

      let transcribedPrompt = rawPrompt;
      if (turnAttachments) {
        const transcription = await DiscordTypingIndicator.during(targetChannel, () =>
          this.orchestratorService.transcribeAudio({ prompt: rawPrompt, attachments: turnAttachments }));
        transcribedPrompt = transcription.prompt;
        turnAttachments = [...transcription.attachments];
        for (const warning of transcription.warnings) {
          await targetChannel.send(warning);
        }
        if (transcription.transcripts.length > 0) {
          await this.sendChunks(targetChannel, this.activityFormatter.formatTranscripts(transcription.transcripts));
        }
      }

      const resolution = await DiscordTypingIndicator.during(targetChannel, () =>
        this.orchestratorService.resolveInput({
          conversationId,
          prompt: transcribedPrompt,
          ...(turnAttachments && turnAttachments.length > 0 ? { attachments: turnAttachments } : {}),
        }));

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
      if (resolution.kind === 'question') {
        await this.sendChunks(targetChannel, this.activityFormatter.formatQuestion(resolution.prompt));
        return;
      }
      if (resolution.kind === 'invalid_answer') {
        await this.sendChunks(targetChannel, this.activityFormatter.formatInvalidAnswer(resolution.prompt));
        return;
      }
      if (resolution.kind === 'answered') {
        await targetChannel.send(this.activityFormatter.formatAnswersSent(resolution.asker));
        if (resolution.next) {
          await this.sendChunks(targetChannel, this.activityFormatter.formatQuestion(resolution.next));
        }
        return;
      }
      if (resolution.kind === 'language_set') {
        await targetChannel.send(this.activityFormatter.formatLanguageSet(resolution.language));
        return;
      }
      if (resolution.kind === 'invalid_language') {
        await targetChannel.send(this.activityFormatter.formatInvalidLanguage());
        return;
      }
      if (resolution.kind === 'profiles_menu') {
        await this.sendChunks(targetChannel, this.activityFormatter.formatSelection(resolution.selection));
        return;
      }
      if (resolution.kind === 'profiles_updated') {
        await this.sendChunks(
          targetChannel,
          [
            this.activityFormatter.formatProfilesUpdated(resolution.updatedRoles, resolution.profile),
            this.activityFormatter.formatSelection(resolution.selection),
          ].join('\n\n'),
        );
        return;
      }
      if (resolution.kind === 'profiles_closed') {
        await targetChannel.send(this.activityFormatter.formatProfilesClosed());
        return;
      }
      if (resolution.configured) {
        await targetChannel.send(this.activityFormatter.formatConfigured(resolution.configured));
      }
      const { prompt } = resolution;

      const progressMessage: ProgressMessage = await targetChannel.send(
        '⏳ *Starting...*',
      );
      let cleanInitialProgressPromise: Promise<void> | null = null;
      const cleanInitialProgress = (): Promise<void> => {
        cleanInitialProgressPromise ??= progressMessage.delete?.().catch(() => undefined) ?? Promise.resolve();
        return cleanInitialProgressPromise;
      };

      const throttler = new DiscordThrottler({ intervalMs: 1500 });
      const toolMessages = new Map<string, Promise<TrackedMessage | null>>();
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
              tracker.isDeleted = true;
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
            const sendPromise = (targetChannel!.send(formatted) as Promise<TrackedMessage>).catch((error: unknown): null => {
              this.logger.warn(`Failed to send tool call message: ${this.describeError(error)}`);
              return null;
            });
            toolMessages.set(activity.toolCallId, sendPromise);
            return;
          }

          if (activity.status === 'completed' || activity.status === 'failed') {
            const prevPromise = toolMessages.get(activity.toolCallId);
            const editPromise = (prevPromise ?? Promise.resolve<TrackedMessage | null>(null))
              .then(async (msg): Promise<TrackedMessage | null> => {
                if (msg && typeof msg.edit === 'function') {
                  await msg.edit(formatted);
                  return msg;
                }
                return (await targetChannel!.send(formatted)) as TrackedMessage;
              })
              .catch((error: unknown): null => {
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

      const onInterimMessage = (text: string): void => {
        typing.keepAlive();
        void cleanInitialProgress();

        delegationChain = delegationChain.then(async () => {
          await throttler.flush();
          try {
            await this.sendChunks(targetChannel!, text);
          } catch (error) {
            this.logger.warn(`Failed to send the interim message: ${this.describeError(error)}`);
          }
        });
      };

      const onQuestion = (prompt: QuestionPrompt): void => {
        typing.keepAlive();
        void cleanInitialProgress();

        delegationChain = delegationChain.then(async () => {
          await throttler.flush();
          try {
            await this.sendChunks(targetChannel!, this.activityFormatter.formatQuestion(prompt));
          } catch (error) {
            this.logger.warn(`Failed to send the question: ${this.describeError(error)}`);
          }
        });
      };

      let result: TurnResult;
      try {
        result = await this.orchestratorService.executeTurn({
          conversationId,
          userId: message.author.id,
          prompt,
          workspacePath: this.workspacePort.getBaseDirectory(),
          agentRole: 'CEO',
          ...(turnAttachments && turnAttachments.length > 0 ? { attachments: turnAttachments } : {}),
          onActivity,
          onDelegation,
          onInterimMessage,
          onQuestion,
          onQueued: () => {
            void progressMessage
              .edit('⏳ *Waiting for the previous task in this conversation to finish...*')
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

      await this.sendTurnResult(targetChannel, conversationId, result);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error processing Discord message: ${errorMessage}`);
      if (targetChannel) {
        await this.sendChunks(
          targetChannel,
          `❌ **An error occurred while processing your request:** ${errorMessage}`,
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
      if (tracker.isDeleted) {
        continue;
      }
      const chunks = this.activityFormatter.splitMessage(
        tracker.currentText,
        DISCORD_MESSAGE_LIMIT,
      );
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        const existingMessage = tracker.messages[i];
        if (existingMessage) {
          if (
            existingMessage.content !== chunk
            && typeof existingMessage.edit === 'function'
          ) {
            try {
              await existingMessage.edit(chunk);
              existingMessage.content = chunk;
            } catch (error) {
              this.logger.warn(`Failed to update thought message: ${this.describeError(error)}`);
            }
          }
        } else {
          try {
            const sent = (await targetChannel.send(chunk)) as TrackedMessage | null | undefined;
            if (tracker.isDeleted) {
              if (typeof sent?.delete === 'function') {
                void sent.delete().catch(() => undefined);
              }
              break;
            }
            if (!sent) {
              break;
            }
            sent.content ??= chunk;
            tracker.messages.push(sent);
          } catch (error) {
            this.logger.warn(`Failed to send thought message: ${this.describeError(error)}`);
            break;
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
    const conversationId = buildConversationId(resolveConversationKey(message.channelId, message.channel));
    return this.orchestratorService.hasPendingQuestions(conversationId)
      || this.orchestratorService.hasPendingLanguageChange(conversationId)
      || await this.orchestratorService.hasActiveConfigSelection(conversationId);
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

  private async sendTurnResult(targetChannel: SendableChannel, conversationId: string, result: TurnResult): Promise<void> {
    const footer = result.agentInfo
      ? this.activityFormatter.formatAgentFooter(result.agentInfo, result.usage)
      : '';

    if (result.status === 'completed') {
      this.logger.log(
        `[Response Sent] Turn completed for conversation ${conversationId}. Length: ${result.response.length} chars`,
      );
      await this.sendChunks(
        targetChannel,
        result.response || '✅ *Task completed with no response message.*',
        footer,
        result.attachments,
      );
      return;
    }

    if (result.status === 'steered') {
      this.logger.log(`[Turn Steered] Prompt joined the running turn of conversation ${conversationId}`);
      await targetChannel.send(STEERED_NOTICE);
      return;
    }

    if (result.status === 'cancelled') {
      this.logger.warn(
        `[Turn Cancelled] Active turn was cancelled for conversation ${conversationId}`,
      );
      await this.sendChunks(targetChannel, '⚠️ **Turn cancelled by the user.**', footer, result.attachments);
      return;
    }

    this.logger.error(
      `[Turn Failed] Turn execution failed for conversation ${conversationId}: ${result.errorMessage}`,
    );
    await this.sendChunks(
      targetChannel,
      `❌ **Execution error**: ${result.errorMessage || 'Unknown failure.'}`,
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
    const chunks = this.activityFormatter.splitMessage(this.activityFormatter.stripLocalLinks(content), limit);
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
