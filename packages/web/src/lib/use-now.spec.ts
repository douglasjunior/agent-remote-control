import { act, renderHook } from '@testing-library/react';

import { useNow } from './use-now.js';


describe('useNow', () => {
  beforeEach(() => {
    rs.useFakeTimers();
    rs.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    rs.useRealTimers();
  });

  it('should tick every second while active', () => {
    const { result } = renderHook(() => useNow(true));
    const start = result.current;

    act(() => rs.advanceTimersByTime(3000));

    expect(result.current).toBe(start + 3000);
  });

  it('should stand still while inactive', () => {
    const { result } = renderHook(() => useNow(false));
    const start = result.current;

    act(() => rs.advanceTimersByTime(3000));

    expect(result.current).toBe(start);
  });

  it('should stop ticking when it becomes inactive', () => {
    const { result, rerender } = renderHook(({ active }) => useNow(active), { initialProps: { active: true } });

    act(() => rs.advanceTimersByTime(1000));
    rerender({ active: false });
    const stopped = result.current;
    act(() => rs.advanceTimersByTime(5000));

    expect(result.current).toBe(stopped);
  });
});
