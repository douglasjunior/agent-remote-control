export function buildConversationKey(channelId: string, threadId?: string): string {
  return `${channelId}:${threadId ?? ''}`;
}
