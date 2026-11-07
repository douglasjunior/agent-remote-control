import { useCallback, useState } from 'react';


function readFlag(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === 'true';
  } catch {
    return fallback;
  }
}

/** A boolean kept in `localStorage`; it works in memory only when storage is blocked. */
export function useStoredFlag(key: string, fallback: boolean): readonly [boolean, (value: boolean) => void] {
  const [flag, setFlag] = useState(() => readFlag(key, fallback));
  const update = useCallback((value: boolean) => {
    setFlag(value);
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // Storage can be blocked (private windows); the choice then lasts until reload.
    }
  }, [key]);
  return [flag, update];
}
