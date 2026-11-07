import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMediaQuery } from './use-media-query.js';


function stubMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return matches;
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  return {
    listeners,
    change(next: boolean) {
      matches = next;
      listeners.forEach(listener => listener());
    },
  };
}

describe('useMediaQuery', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('follows the query as the window changes', () => {
    const media = stubMedia(false);
    const { result } = renderHook(() => useMediaQuery('(max-width: 820px)'));
    expect(result.current).toBe(false);

    act(() => media.change(true));
    expect(result.current).toBe(true);
  });

  it('stops listening when unmounted', () => {
    const media = stubMedia(true);
    const { unmount } = renderHook(() => useMediaQuery('(max-width: 820px)'));
    expect(media.listeners.size).toBe(1);

    unmount();
    expect(media.listeners.size).toBe(0);
  });
});
