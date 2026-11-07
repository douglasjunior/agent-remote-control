import { useCallback, useSyncExternalStore } from 'react';


/** Whether the media query matches right now, kept current as the window changes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const media = matchMedia(query);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}
