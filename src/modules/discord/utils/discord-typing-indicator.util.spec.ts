import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DiscordTypingIndicator,
  type TypingChannel,
} from './discord-typing-indicator.util.js';


describe('DiscordTypingIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('triggers sendTyping immediately on start', () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel);

    indicator.start();

    expect(sendTyping).toHaveBeenCalledTimes(1);
    indicator.stop();
  });

  it('triggers sendTyping periodically at the configured interval', () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel, { intervalMs: 8000 });

    indicator.start();
    expect(sendTyping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(8000);
    expect(sendTyping).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(8000);
    expect(sendTyping).toHaveBeenCalledTimes(3);

    indicator.stop();
  });

  it('uses default interval of 8000ms and default idle timeout of 5 minutes', () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel);

    indicator.start();
    expect(sendTyping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(8000);
    expect(sendTyping).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(5 * 60 * 1000 - 8000);
    expect(sendTyping).toHaveBeenCalledTimes(38);

    vi.advanceTimersByTime(8000);
    expect(sendTyping).toHaveBeenCalledTimes(38);
  });

  it('swallows asynchronous errors from sendTyping', async () => {
    const sendTyping = vi.fn().mockRejectedValue(new Error('Discord API 429'));
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel, { intervalMs: 1000 });

    indicator.start();
    expect(sendTyping).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(sendTyping).toHaveBeenCalledTimes(2);

    indicator.stop();
  });

  it('swallows synchronous exceptions from sendTyping', () => {
    const sendTyping = vi.fn().mockImplementation(() => {
      throw new Error('Immediate failure');
    });
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel, { intervalMs: 1000 });

    expect(() => indicator.start()).not.toThrow();
    expect(sendTyping).toHaveBeenCalledTimes(1);

    indicator.stop();
  });

  it('handles channels without sendTyping gracefully', () => {
    const channel: TypingChannel = {};
    const indicator = new DiscordTypingIndicator(channel, { intervalMs: 1000 });

    expect(() => indicator.start()).not.toThrow();

    vi.advanceTimersByTime(1000);
    indicator.stop();
  });

  it('clears previous timers when start is invoked multiple times', () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel, { intervalMs: 2000 });

    indicator.start();
    expect(sendTyping).toHaveBeenCalledTimes(1);

    indicator.start();
    expect(sendTyping).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(2000);
    expect(sendTyping).toHaveBeenCalledTimes(3);

    indicator.stop();
  });

  it('resets idle watchdog timer on keepAlive', () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel, {
      intervalMs: 1000,
      idleTimeoutMs: 5000,
    });

    indicator.start();
    expect(sendTyping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4000);
    expect(sendTyping).toHaveBeenCalledTimes(5);

    indicator.keepAlive();

    vi.advanceTimersByTime(2000);
    expect(sendTyping).toHaveBeenCalledTimes(7);

    vi.advanceTimersByTime(3000);
    expect(sendTyping).toHaveBeenCalledTimes(10);

    vi.advanceTimersByTime(2000);
    expect(sendTyping).toHaveBeenCalledTimes(10);
  });

  it('does nothing when keepAlive is called while inactive', () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel, {
      intervalMs: 1000,
      idleTimeoutMs: 5000,
    });

    indicator.keepAlive();
    vi.advanceTimersByTime(10000);

    expect(sendTyping).not.toHaveBeenCalled();
  });

  it('stops typing when idleTimeoutMs expires without keepAlive', () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel, {
      intervalMs: 1000,
      idleTimeoutMs: 3000,
    });

    indicator.start();
    expect(sendTyping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    expect(sendTyping).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(1000);
    expect(sendTyping).toHaveBeenCalledTimes(4);

    vi.advanceTimersByTime(2000);
    expect(sendTyping).toHaveBeenCalledTimes(4);
  });

  it('stops typing and clears all timers on stop', () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel, {
      intervalMs: 1000,
      idleTimeoutMs: 5000,
    });

    indicator.start();
    expect(sendTyping).toHaveBeenCalledTimes(1);

    indicator.stop();

    vi.advanceTimersByTime(10000);
    expect(sendTyping).toHaveBeenCalledTimes(1);
  });

  it('allows safe repeated calls to stop', () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const channel: TypingChannel = { sendTyping };
    const indicator = new DiscordTypingIndicator(channel);

    expect(() => {
      indicator.stop();
      indicator.stop();
    }).not.toThrow();
  });
});
