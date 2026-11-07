import { act, renderHook } from '@testing-library/react';

import { useNow } from './use-now.js';


describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks every second while active', () => {
    const { result } = renderHook(() => useNow(true));
    const start = result.current;

    act(() => vi.advanceTimersByTime(3000));

    expect(result.current).toBe(start + 3000);
  });

  it('stands still while inactive', () => {
    const { result } = renderHook(() => useNow(false));
    const start = result.current;

    act(() => vi.advanceTimersByTime(3000));

    expect(result.current).toBe(start);
  });

  it('stops ticking when it becomes inactive', () => {
    const { result, rerender } = renderHook(({ active }) => useNow(active), { initialProps: { active: true } });

    act(() => vi.advanceTimersByTime(1000));
    rerender({ active: false });
    const stopped = result.current;
    act(() => vi.advanceTimersByTime(5000));

    expect(result.current).toBe(stopped);
  });
});
