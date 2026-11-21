import { useSyncExternalStore } from 'react';


const TICK_MS = 1000;

let snapshot = Date.now();
const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | undefined;
let catchUp: ReturnType<typeof setTimeout> | undefined;

function refresh(): void {
  snapshot = Date.now();
  for (const listener of [...listeners]) {
    listener();
  }
}

// The snapshot never changes inside `subscribe`: React compares it right after subscribing, so a change there
// forces a re-render of every subscriber, which resubscribes when updates are paused and resumed.
function subscribeToClock(onChange: () => void): () => void {
  if (listeners.size === 0) {
    ticker = setInterval(refresh, TICK_MS);
    catchUp = setTimeout(() => {
      catchUp = undefined;
      refresh();
    }, 0);
  }
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      clearInterval(ticker);
      clearTimeout(catchUp);
      ticker = undefined;
      catchUp = undefined;
    }
  };
}

function subscribeToNothing(): () => void {
  return () => undefined;
}

const readSnapshot = () => snapshot;

/**
 * The current time in milliseconds, refreshed every second while `active`, by one timer shared by every active
 * caller; frozen otherwise. The first caller to activate an idle clock gets an immediate asynchronous refresh.
 */
export function useNow(active: boolean): number {
  return useSyncExternalStore(active ? subscribeToClock : subscribeToNothing, readSnapshot);
}
