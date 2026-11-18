import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';

import { Countdown } from './countdown.model.js';


describe('Countdown', () => {
  beforeEach(() => {
    rs.useFakeTimers();
    rs.setSystemTime(1_000_000);
  });

  afterEach(() => {
    rs.useRealTimers();
  });

  it('should report the deadline while it runs and run the callback once the time has passed', () => {
    const countdown = new Countdown();
    const onEnd = rs.fn();

    const deadline = countdown.start(60_000, onEnd);

    expect(deadline).toEqual({ expiresAt: 1_060_000, durationMs: 60_000 });
    expect(countdown.deadline).toEqual(deadline);
    rs.advanceTimersByTime(59_999);
    expect(onEnd).not.toHaveBeenCalled();
    rs.advanceTimersByTime(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(countdown.deadline).toBeUndefined();
  });

  it('should not run the callback after it was stopped', () => {
    const countdown = new Countdown();
    const onEnd = rs.fn();
    countdown.start(60_000, onEnd);

    countdown.stop();
    rs.advanceTimersByTime(120_000);

    expect(onEnd).not.toHaveBeenCalled();
    expect(countdown.deadline).toBeUndefined();
  });

  it('should drop the previous countdown when it is started again', () => {
    const countdown = new Countdown();
    const first = rs.fn();
    const second = rs.fn();
    countdown.start(60_000, first);

    countdown.start(10_000, second);
    rs.advanceTimersByTime(60_000);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
