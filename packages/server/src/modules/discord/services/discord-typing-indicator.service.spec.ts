import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';

import {
  DiscordTypingIndicator,
  type TypingChannel,
} from './discord-typing-indicator.service.js';


describe('DiscordTypingIndicator', () => {
  beforeEach(() => {
    rs.useFakeTimers();
  });

  afterEach(() => {
    rs.restoreAllMocks();
    rs.useRealTimers();
  });

  it('should trigger sendTyping immediately on start', () => {
    const sendTyping = rs.fn().mockResolvedValue(undefined);
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel);

    indicator.start();

    expect(sendTyping).toHaveBeenCalledTimes(1);
    indicator.stop();
  });

  it('should trigger sendTyping periodically at the configured interval', () => {
    const sendTyping = rs.fn().mockResolvedValue(undefined);
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel, { intervalMs: 8000 });

    indicator.start();
    expect(sendTyping).toHaveBeenCalledTimes(1);

    rs.advanceTimersByTime(8000);
    expect(sendTyping).toHaveBeenCalledTimes(2);

    rs.advanceTimersByTime(8000);
    expect(sendTyping).toHaveBeenCalledTimes(3);

    indicator.stop();
  });

  it('should use default interval of 8000ms and default idle timeout of 5 minutes', () => {
    const sendTyping = rs.fn().mockResolvedValue(undefined);
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel);

    indicator.start();
    expect(sendTyping).toHaveBeenCalledTimes(1);

    rs.advanceTimersByTime(8000);
    expect(sendTyping).toHaveBeenCalledTimes(2);

    rs.advanceTimersByTime(5 * 60 * 1000 - 8000);
    expect(sendTyping).toHaveBeenCalledTimes(38);

    rs.advanceTimersByTime(8000);
    expect(sendTyping).toHaveBeenCalledTimes(38);
  });

  it('should swallow asynchronous errors from sendTyping', async () => {
    const sendTyping = rs.fn().mockRejectedValue(new Error('Discord API 429'));
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel, { intervalMs: 1000 });

    indicator.start();
    expect(sendTyping).toHaveBeenCalledTimes(1);

    await rs.advanceTimersByTimeAsync(1000);
    expect(sendTyping).toHaveBeenCalledTimes(2);

    indicator.stop();
  });

  it('should swallow synchronous exceptions from sendTyping', () => {
    const sendTyping = rs.fn().mockImplementation(() => {
      throw new Error('Immediate failure');
    });
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel, { intervalMs: 1000 });

    expect(() => indicator.start()).not.toThrow();
    expect(sendTyping).toHaveBeenCalledTimes(1);

    indicator.stop();
  });

  it('should handle channels without sendTyping gracefully', () => {
    const channel: TypingChannel = {};
    const indicator = new DiscordTypingIndicator(channel, { intervalMs: 1000 });

    expect(() => indicator.start()).not.toThrow();

    rs.advanceTimersByTime(1000);
    indicator.stop();
  });

  it('should clear previous timers when start is invoked multiple times', () => {
    const sendTyping = rs.fn().mockResolvedValue(undefined);
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel, { intervalMs: 2000 });

    indicator.start();
    expect(sendTyping).toHaveBeenCalledTimes(1);

    indicator.start();
    expect(sendTyping).toHaveBeenCalledTimes(2);

    rs.advanceTimersByTime(2000);
    expect(sendTyping).toHaveBeenCalledTimes(3);

    indicator.stop();
  });

  it('should reset idle watchdog timer on keepAlive', () => {
    const sendTyping = rs.fn().mockResolvedValue(undefined);
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel, {
      intervalMs: 1000,
      idleTimeoutMs: 5500,
    });

    indicator.start();
    expect(sendTyping).toHaveBeenCalledTimes(1);

    rs.advanceTimersByTime(4000);
    expect(sendTyping).toHaveBeenCalledTimes(5);

    indicator.keepAlive();

    rs.advanceTimersByTime(2000);
    expect(sendTyping).toHaveBeenCalledTimes(7);

    rs.advanceTimersByTime(3000);
    expect(sendTyping).toHaveBeenCalledTimes(10);

    rs.advanceTimersByTime(2000);
    expect(sendTyping).toHaveBeenCalledTimes(10);
  });

  it('should do nothing when keepAlive is called while inactive', () => {
    const sendTyping = rs.fn().mockResolvedValue(undefined);
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel, {
      intervalMs: 1000,
      idleTimeoutMs: 5000,
    });

    indicator.keepAlive();
    rs.advanceTimersByTime(10000);

    expect(sendTyping).not.toHaveBeenCalled();
  });

  it('should stop typing when idleTimeoutMs expires without keepAlive', () => {
    const sendTyping = rs.fn().mockResolvedValue(undefined);
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel, {
      intervalMs: 1000,
      idleTimeoutMs: 3500,
    });

    indicator.start();
    expect(sendTyping).toHaveBeenCalledTimes(1);

    rs.advanceTimersByTime(2000);
    expect(sendTyping).toHaveBeenCalledTimes(3);

    rs.advanceTimersByTime(1500);
    expect(sendTyping).toHaveBeenCalledTimes(4);

    rs.advanceTimersByTime(2000);
    expect(sendTyping).toHaveBeenCalledTimes(4);
  });

  it('should stop typing and clear all timers on stop', () => {
    const sendTyping = rs.fn().mockResolvedValue(undefined);
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel, {
      intervalMs: 1000,
      idleTimeoutMs: 5000,
    });

    indicator.start();
    expect(sendTyping).toHaveBeenCalledTimes(1);

    indicator.stop();

    rs.advanceTimersByTime(10000);
    expect(sendTyping).toHaveBeenCalledTimes(1);
  });

  it('should allow safe repeated calls to stop', () => {
    const sendTyping = rs.fn().mockResolvedValue(undefined);
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel);

    expect(() => {
      indicator.stop();
      indicator.stop();
    }).not.toThrow();
  });

  describe('during', () => {
    it('should keep typing while the work runs and stop when it resolves', async () => {
      const sendTyping = rs.fn().mockResolvedValue(undefined);
      let resolveWork: (value: string) => void = () => undefined;
      const work = new Promise<string>((resolve) => {
        resolveWork = resolve;
      });

      const result = DiscordTypingIndicator.during({ sendTyping }, () => work);
      rs.advanceTimersByTime(8000);
      expect(sendTyping).toHaveBeenCalledTimes(2);

      resolveWork('done');
      await expect(result).resolves.toBe('done');
      rs.advanceTimersByTime(20000);
      expect(sendTyping).toHaveBeenCalledTimes(2);
    });

    it('should stop typing when the work fails', async () => {
      const sendTyping = rs.fn().mockResolvedValue(undefined);

      await expect(
        DiscordTypingIndicator.during({ sendTyping }, () => Promise.reject(new Error('probe failed'))),
      ).rejects.toThrow('probe failed');

      rs.advanceTimersByTime(20000);
      expect(sendTyping).toHaveBeenCalledTimes(1);
    });
  });
});
