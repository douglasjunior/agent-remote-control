import { useCallback, useEffect, useState } from 'react';

import { useConnection } from '../connection/connection-context.js';

import type { ConversationView } from './conversations-reducer.js';


/**
 * Asks for the page before the loaded entries of a conversation, once for each position, while the history holds
 * earlier ones. A request a lost connection never answered can be made again once the connection is back.
 */
export function useEarlierEntries(conversationId: string, view: ConversationView) {
  const { connection, status } = useConnection();
  const [requestedBefore, setRequestedBefore] = useState<number | null>(null);
  const available = view.loaded && view.start > 0;
  const loading = available && status === 'open' && requestedBefore === view.start;

  useEffect(() => connection.onStatus((next) => {
    if (next !== 'open') {
      setRequestedBefore(null);
    }
  }), [connection]);

  const load = useCallback(() => {
    if (!available || loading || status !== 'open') {
      return;
    }
    setRequestedBefore(view.start);
    connection.send({ type: 'conversation.entries', conversationId, before: view.start });
  }, [available, loading, status, view.start, connection, conversationId]);

  return { available, loading, load };
}
