import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';

import { DiscordThrottler } from './discord-throttler.service.js';


describe('DiscordThrottler', () => {
  beforeEach(() => {
    rs.useFakeTimers();
  });

  afterEach(() => {
    rs.restoreAllMocks();
  });

  it('should execute first scheduled action immediately if interval has passed', async () => {
    const throttler = new DiscordThrottler({ intervalMs: 500 });
    const action = rs.fn().mockResolvedValue(undefined);

    throttler.schedule(action);

    await rs.waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });
  });

  it('should coalesce rapid actions and only execute the latest after intervalMs', async () => {
    const throttler = new DiscordThrottler({ intervalMs: 1000 });
    const executed: number[] = [];

    const action1 = rs.fn().mockImplementation(async () => {
      executed.push(1);
    });
    const action2 = rs.fn().mockImplementation(async () => {
      executed.push(2);
    });
    const action3 = rs.fn().mockImplementation(async () => {
      executed.push(3);
    });

    throttler.schedule(action1);
    expect(executed).toEqual([1]);

    throttler.schedule(action2);
    throttler.schedule(action3);

    expect(executed).toEqual([1]);

    await rs.advanceTimersByTimeAsync(1000);

    expect(executed).toEqual([1, 3]);
    expect(action2).not.toHaveBeenCalled();
  });

  it('should handle actions scheduled while execution is in progress', async () => {
    const throttler = new DiscordThrottler({ intervalMs: 500 });
    const executed: string[] = [];

    let resolveAction1: () => void = () => undefined;
    const action1Promise = new Promise<void>((resolve) => {
      resolveAction1 = resolve;
    });

    const action1 = rs.fn().mockImplementation(async () => {
      await action1Promise;
      executed.push('action1');
    });

    const action2 = rs.fn().mockImplementation(async () => {
      executed.push('action2');
    });

    throttler.schedule(action1);
    throttler.schedule(action2);

    resolveAction1();
    await rs.advanceTimersByTimeAsync(10);
    expect(executed).toEqual(['action1']);

    await rs.advanceTimersByTimeAsync(500);
    expect(executed).toEqual(['action1', 'action2']);
  });

  it('should catch error in action and continue running subsequent actions', async () => {
    const throttler = new DiscordThrottler({ intervalMs: 500 });
    const failingAction = rs.fn().mockRejectedValue(new Error('Network error'));
    const nextAction = rs.fn().mockResolvedValue(undefined);

    throttler.schedule(failingAction);

    await rs.waitFor(() => {
      expect(failingAction).toHaveBeenCalledTimes(1);
    });

    throttler.schedule(nextAction);
    await rs.advanceTimersByTimeAsync(500);

    expect(nextAction).toHaveBeenCalledTimes(1);
  });

  it('should flush pending action immediately without waiting for timer', async () => {
    const throttler = new DiscordThrottler({ intervalMs: 1000 });
    const executed: string[] = [];

    const action1 = rs.fn().mockImplementation(async () => {
      executed.push('first');
    });
    const action2 = rs.fn().mockImplementation(async () => {
      executed.push('second');
    });

    throttler.schedule(action1);
    throttler.schedule(action2);

    expect(executed).toEqual(['first']);

    await throttler.flush();

    expect(executed).toEqual(['first', 'second']);
  });

  it('should flush while an action is executing and then execute pending', async () => {
    const throttler = new DiscordThrottler({ intervalMs: 1000 });
    const executed: string[] = [];

    let finishSlow: () => void = () => undefined;
    const slowAction = rs.fn().mockImplementation(async () => {
      await new Promise<void>((res) => {
        finishSlow = res;
      });
      executed.push('slow');
    });

    const pendingAction = rs.fn().mockImplementation(async () => {
      executed.push('pending');
    });

    throttler.schedule(slowAction);
    throttler.schedule(pendingAction);

    const flushPromise = throttler.flush();

    finishSlow();
    await flushPromise;

    expect(executed).toEqual(['slow', 'pending']);
  });

  it('should destroy pending timer and clear pending action', async () => {
    const throttler = new DiscordThrottler({ intervalMs: 1000 });
    const executed: string[] = [];

    const action1 = rs.fn().mockImplementation(async () => {
      executed.push('first');
    });
    const action2 = rs.fn().mockImplementation(async () => {
      executed.push('second');
    });

    throttler.schedule(action1);
    throttler.schedule(action2);

    throttler.destroy();

    await rs.advanceTimersByTimeAsync(2000);

    expect(executed).toEqual(['first']);
    expect(action2).not.toHaveBeenCalled();
  });

  it('should clear active timer when flush is called during wait interval', async () => {
    const throttler = new DiscordThrottler({ intervalMs: 1000 });
    const executed: string[] = [];

    const action1 = rs.fn().mockImplementation(async () => {
      executed.push('first');
    });
    const action2 = rs.fn().mockImplementation(async () => {
      executed.push('second');
    });

    throttler.schedule(action1);
    await rs.advanceTimersByTimeAsync(0);

    throttler.schedule(action2);
    await rs.advanceTimersByTimeAsync(0);

    await throttler.flush();
    expect(executed).toEqual(['first', 'second']);
  });

  it('should clear active timer when destroy is called during wait interval', async () => {
    const throttler = new DiscordThrottler({ intervalMs: 1000 });
    const executed: string[] = [];

    const action1 = rs.fn().mockImplementation(async () => {
      executed.push('first');
    });
    const action2 = rs.fn().mockImplementation(async () => {
      executed.push('second');
    });

    throttler.schedule(action1);
    await rs.advanceTimersByTimeAsync(1000);

    throttler.schedule(action2);
    await rs.advanceTimersByTimeAsync(100);

    throttler.schedule(action2);
    throttler.destroy();

    await rs.advanceTimersByTimeAsync(2000);

    expect(executed).toEqual(['first', 'second']);
  });

  it('should not throw if flush is called when empty', async () => {
    const throttler = new DiscordThrottler();
    await expect(throttler.flush()).resolves.toBeUndefined();
  });

  it('should use default 1000ms interval when no options provided', async () => {
    const throttler = new DiscordThrottler();
    const executed: string[] = [];

    const action1 = rs.fn().mockImplementation(async () => {
      executed.push('first');
    });
    const action2 = rs.fn().mockImplementation(async () => {
      executed.push('second');
    });

    throttler.schedule(action1);
    throttler.schedule(action2);

    await rs.advanceTimersByTimeAsync(999);
    expect(executed).toEqual(['first']);

    await rs.advanceTimersByTimeAsync(1);
    expect(executed).toEqual(['first', 'second']);
  });
});
