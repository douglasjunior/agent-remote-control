import type { Channel } from 'discord.js';


export type ConversationKey = { readonly channelId: string; readonly threadId?: string };

export function resolveConversationKey(channelId: string, channel: Channel | null | undefined): ConversationKey {
  if (!channel?.isThread()) {
    return { channelId };
  }
  return { channelId: channel.parentId ?? channel.id, threadId: channel.id };
}
