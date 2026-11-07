import type { Channel } from 'discord.js';


export type ConversationKey = { readonly channelId: string; readonly threadId?: string };

export function resolveConversationKey(channelId: string, channel: Channel | null | undefined): ConversationKey {
  if (!channel?.isThread()) {
    return { channelId };
  }
  return { channelId: channel.parentId ?? channel.id, threadId: channel.id };
}

/** Identifier the orchestrator uses for the conversation: the parent channel and the thread joined, or the channel alone. */
export function buildConversationId(key: ConversationKey): string {
  return key.threadId ? `${key.channelId}:${key.threadId}` : key.channelId;
}
