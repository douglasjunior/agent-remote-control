import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { useState } from 'react';


function delegatedInCurrentTurn(entries: readonly ConversationEntry[]): boolean {
  const lastUserMessage = entries.findLastIndex(entry => entry.type === 'user_message');
  return entries.slice(lastUserMessage + 1).some(entry => entry.type === 'delegation');
}

/**
 * Counts the deliveries seen live: a turn that was running here, delegated, and ended with a completed answer. A
 * conversation opened with its turn already over never counts.
 */
export function useDelivery(entries: readonly ConversationEntry[], running: boolean): number {
  const [seen, setSeen] = useState({ sawRunning: false, deliveries: 0 });
  const last = entries.at(-1);

  let next = seen;
  if (running && !seen.sawRunning) {
    next = { ...seen, sawRunning: true };
  } else if (!running && seen.sawRunning && last?.type === 'agent_response') {
    const delivered = last.status === 'completed' && delegatedInCurrentTurn(entries);
    next = { sawRunning: false, deliveries: seen.deliveries + (delivered ? 1 : 0) };
  }
  if (next !== seen) {
    setSeen(next);
  }
  return next.deliveries;
}
