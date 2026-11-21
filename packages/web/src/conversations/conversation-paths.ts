export function conversationPath(conversationId: string): string {
  return `/c/${conversationId}`;
}

/** The squad of a conversation: its own pane on a narrow window, the side panel on a wide one. */
export function squadPath(conversationId: string): string {
  return `${conversationPath(conversationId)}/squad`;
}
