import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { useState } from 'react';


/** Whether the turn a response closes delegated: a turn spans the entries after the response before it. */
function delegatedInTurnOf(entries: readonly ConversationEntry[], response: number): boolean {
  const previous = entries.findLastIndex((entry, index) => index < response && entry.type === 'agent_response');
  return entries.slice(previous + 1, response).some(entry => entry.type === 'delegation');
}

/**
 * Counts the deliveries seen live: a response that arrived after a turn was seen running here, closing a turn that
 * delegated with a completed answer. A conversation opened with its turn already over never counts, and neither does
 * a response that was already there.
 */
export function useDelivery(entries: readonly ConversationEntry[], running: boolean): number {
  const [seen, setSeen] = useState<{ responseId?: string; sawRunning: boolean; deliveries: number }>({ sawRunning: false, deliveries: 0 });
  const index = entries.findLastIndex(entry => entry.type === 'agent_response');
  const response = entries[index];

  let next = seen;
  if (response && response.id !== seen.responseId) {
    const delivered = seen.sawRunning && response.type === 'agent_response' && response.status === 'completed' && delegatedInTurnOf(entries, index);
    next = { responseId: response.id, sawRunning: running, deliveries: seen.deliveries + (delivered ? 1 : 0) };
  } else if (running && !seen.sawRunning) {
    next = { ...seen, sawRunning: true };
  }
  if (next !== seen) {
    setSeen(next);
  }
  return next.deliveries;
}
