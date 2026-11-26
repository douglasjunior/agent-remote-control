import { act, render, renderHook } from '@testing-library/react';

import { useNow } from './use-now.js';


function Clock({ active = true, onRender }: { active?: boolean; onRender: (now: number) => void }) {
  onRender(useNow(active));
  return null;
}

describe('useNow', () => {
  beforeEach(() => {
    rs.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    rs.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    rs.useRealTimers();
  });

  it('should tick every second while active', () => {
    const { result } = renderHook(() => useNow(true));
    const start = Date.now();

    act(() => rs.advanceTimersByTime(3000));

    expect(result.current).toBe(start + 3000);
  });

  it('should stand still while inactive', () => {
    const { result } = renderHook(() => useNow(false));
    const start = result.current;

    act(() => rs.advanceTimersByTime(3000));

    expect(result.current).toBe(start);
    expect(rs.getTimerCount()).toBe(0);
  });

  it('should stop ticking when it becomes inactive', () => {
    const { result, rerender } = renderHook(({ active }) => useNow(active), { initialProps: { active: true } });

    act(() => rs.advanceTimersByTime(1000));
    rerender({ active: false });
    const stopped = result.current;
    act(() => rs.advanceTimersByTime(5000));

    expect(result.current).toBe(stopped);
    expect(rs.getTimerCount()).toBe(0);
  });

  it('should refresh right after the first subscriber arrives at an idle clock', () => {
    const before = renderHook(() => useNow(false)).result.current;
    rs.setSystemTime(Date.now() + 10_000);

    const { result } = renderHook(() => useNow(true));
    expect(result.current).toBe(before);

    act(() => rs.advanceTimersByTime(0));

    expect(result.current).toBe(Date.now());
    expect(result.current).toBeGreaterThan(before);
  });

  it('should not render extra times when several components subscribe', () => {
    const renders = [rs.fn(), rs.fn(), rs.fn()];

    render(
      <>
        {renders.map((onRender, index) => <Clock key={index} onRender={onRender} />)}
      </>,
    );
    act(() => rs.advanceTimersByTime(0));
    const afterCatchUp = renders.map(onRender => onRender.mock.calls.length);

    act(() => rs.advanceTimersByTime(1000));

    expect(afterCatchUp).toEqual([2, 2, 2]);
    expect(renders.map(onRender => onRender.mock.calls.length)).toEqual([3, 3, 3]);
  });

  it('should not change the snapshot while a component subscribes', () => {
    const first = renderHook(() => useNow(true));
    act(() => rs.advanceTimersByTime(1000));
    const seen = first.result.current;
    rs.setSystemTime(Date.now() + 400);

    const second = renderHook(() => useNow(true));

    expect(second.result.current).toBe(seen);
    expect(first.result.current).toBe(seen);
  });

  it('should share one interval among every active component', () => {
    const setIntervalSpy = rs.spyOn(globalThis, 'setInterval');

    render(
      <>
        <Clock onRender={() => undefined} />
        <Clock onRender={() => undefined} />
        <Clock onRender={() => undefined} />
      </>,
    );

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    setIntervalSpy.mockRestore();
  });

  it('should keep ticking for the rest while one component unmounts', () => {
    const seen = rs.fn();
    const first = render(<Clock onRender={() => undefined} />);
    render(<Clock onRender={seen} />);
    act(() => rs.advanceTimersByTime(1000));
    first.unmount();
    seen.mockClear();

    act(() => rs.advanceTimersByTime(1000));
    act(() => rs.advanceTimersByTime(1000));

    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('should stop the interval when the last component unmounts', () => {
    const first = render(<Clock onRender={() => undefined} />);
    const second = render(<Clock onRender={() => undefined} />);
    act(() => rs.advanceTimersByTime(1000));
    expect(rs.getTimerCount()).toBe(1);

    first.unmount();
    expect(rs.getTimerCount()).toBe(1);
    second.unmount();

    expect(rs.getTimerCount()).toBe(0);
  });

  it('should cancel the pending catch-up when everyone unsubscribes first', () => {
    const { unmount } = render(<Clock onRender={() => undefined} />);
    expect(rs.getTimerCount()).toBe(2);

    unmount();

    expect(rs.getTimerCount()).toBe(0);
  });
});
