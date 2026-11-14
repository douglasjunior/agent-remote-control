/** The board of a conversation. */
export function boardPath(conversationId: string): string {
  return `/c/${conversationId}/tasks`;
}

export function artifactPath(conversationId: string, artifactId: string): string {
  return `${boardPath(conversationId)}/${artifactId}`;
}
