import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';


export type QuestionEntry = Extract<ConversationEntry, { type: 'question' }>;

/** The question the user can still answer: the last one the server has not closed, wherever it sits in the history. */
export function openQuestion(entries: readonly ConversationEntry[]): QuestionEntry | undefined {
  return entries.findLast((entry): entry is QuestionEntry => entry.type === 'question' && !entry.closed);
}
