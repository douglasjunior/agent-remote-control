import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useStoredFlag } from './use-stored-flag.js';


describe('useStoredFlag', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('starts with the fallback when nothing is stored', () => {
    expect(renderHook(() => useStoredFlag('k', true)).result.current[0]).toBe(true);
    expect(renderHook(() => useStoredFlag('k', false)).result.current[0]).toBe(false);
  });

  it('stores the value and restores it in a new mount', () => {
    const first = renderHook(() => useStoredFlag('k', true));
    act(() => first.result.current[1](false));
    expect(first.result.current[0]).toBe(false);
    expect(localStorage.getItem('k')).toBe('false');

    expect(renderHook(() => useStoredFlag('k', true)).result.current[0]).toBe(false);
    act(() => first.result.current[1](true));
    expect(renderHook(() => useStoredFlag('k', false)).result.current[0]).toBe(true);
  });

  it('keeps working in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useStoredFlag('k', true));
    expect(result.current[0]).toBe(true);

    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
  });
});
