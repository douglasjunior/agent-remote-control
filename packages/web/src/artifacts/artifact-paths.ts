import { conversationPath } from '../conversations/conversation-paths.js';


/** The board of a conversation. */
export function boardPath(conversationId: string): string {
  return `${conversationPath(conversationId)}/tasks`;
}

export function artifactPath(conversationId: string, artifactId: string): string {
  return `${boardPath(conversationId)}/${artifactId}`;
}
