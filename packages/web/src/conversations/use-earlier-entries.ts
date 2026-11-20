import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useConnection } from '../connection/connection-context.js';

import type { ConversationView } from './conversations-reducer.js';


/**
 * Asks for the page before the loaded entries of a conversation, once for each position, while the history holds
 * earlier ones. A request a lost connection never answered can be made again once the connection is back.
 *
 * `load` decides from refs, not from the render it was created in: the feed's virtual list calls the callback it holds
 * on its own schedule, and a call that lands after a click asked for the same position, before the render that
 * followed, would otherwise send the request twice.
 */
export function useEarlierEntries(conversationId: string, view: ConversationView) {
  const { connection, status } = useConnection();
  const [requestedBefore, setRequestedBefore] = useState<number | null>(null);
  const available = view.loaded && view.start > 0;
  const loading = available && status === 'open' && requestedBefore === view.start;
  const requested = useRef<number | null>(null);
  const latest = useRef({ available, status, start: view.start });

  useLayoutEffect(() => {
    latest.current = { available, status, start: view.start };
  });

  useEffect(() => connection.onStatus((next) => {
    latest.current = { ...latest.current, status: next };
    if (next !== 'open') {
      requested.current = null;
      setRequestedBefore(null);
    }
  }), [connection]);

  const load = useCallback(() => {
    const { available: canLoad, status: current, start } = latest.current;
    if (!canLoad || current !== 'open' || requested.current === start) {
      return;
    }
    requested.current = start;
    setRequestedBefore(start);
    connection.send({ type: 'conversation.entries', conversationId, before: start });
  }, [connection, conversationId]);

  return { available, loading, load };
}
