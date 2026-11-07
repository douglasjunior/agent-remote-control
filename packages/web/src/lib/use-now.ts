import { useSyncExternalStore } from 'react';


let snapshot = Date.now();

function subscribeToClock(onChange: () => void): () => void {
  snapshot = Date.now();
  const timer = setInterval(() => {
    snapshot = Date.now();
    onChange();
  }, 1000);
  return () => clearInterval(timer);
}

function subscribeToNothing(): () => void {
  return () => undefined;
}

const readSnapshot = () => snapshot;

/** The current time in milliseconds, refreshed every second while `active`; frozen otherwise. */
export function useNow(active: boolean): number {
  return useSyncExternalStore(active ? subscribeToClock : subscribeToNothing, readSnapshot);
}
