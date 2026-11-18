import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';

import { PromptCancelledError } from '../../agent/ports/agent.port.js';
import { retryListener } from '../testing/retry-listener.fixture.js';

import { TurnRetryService } from './turn-retry.service.js';


const FAILURE = { roleName: 'CEO', errorMessage: 'Service unavailable', attempt: 2 };

describe('TurnRetryService', () => {
  let service: TurnRetryService;

  beforeEach(() => {
    rs.useFakeTimers();
    rs.setSystemTime(1_000_000);
    service = new TurnRetryService();
  });

  afterEach(() => {
    rs.useRealTimers();
  });

  it('should show the wait with the time the retry happens at', () => {
    const scheduled = rs.fn();

    void service.wait('conv-1', FAILURE, 60_000, retryListener({ scheduled }));

    expect(scheduled).toHaveBeenCalledWith({ ...FAILURE, timeout: { expiresAt: 1_060_000, durationMs: 60_000 } });
    expect(service.hasPendingRetry('conv-1')).toBe(true);
    expect(service.hasPendingRetry('conv-2')).toBe(false);
  });

  it('should retry when the time passes, and report why the wait ended', async () => {
    const ended = rs.fn();
    const waiting = service.wait('conv-1', FAILURE, 60_000, retryListener({ ended }));

    rs.advanceTimersByTime(60_000);

    await expect(waiting).resolves.toEqual({ kind: 'retry' });
    expect(ended).toHaveBeenCalledWith('elapsed');
    expect(service.hasPendingRetry('conv-1')).toBe(false);
  });

  it('should retry now, with the message the user wrote', async () => {
    const ended = rs.fn();
    const waiting = service.wait('conv-1', FAILURE, 60_000, retryListener({ ended }));

    expect(service.retryNow('conv-1', { text: '  I logged in again.  ' })).toBe(true);

    await expect(waiting).resolves.toEqual({ kind: 'retry', message: 'I logged in again.' });
    expect(ended).toHaveBeenCalledWith('requested');
    expect(service.hasPendingRetry('conv-1')).toBe(false);
  });

  it('should retry now without a message when the user wrote none or only blanks', async () => {
    const first = service.wait('conv-1', FAILURE, 60_000, retryListener());
    service.retryNow('conv-1');
    const second = service.wait('conv-1', FAILURE, 60_000, retryListener());
    service.retryNow('conv-1', { text: '   ' });

    await expect(first).resolves.toEqual({ kind: 'retry' });
    await expect(second).resolves.toEqual({ kind: 'retry' });
  });

  it('should list the files the user attached with the message', async () => {
    const waiting = service.wait('conv-1', FAILURE, 60_000, retryListener());

    service.retryNow('conv-1', { text: 'See this.', attachments: [{ name: 'log.txt', path: '/tmp/log.txt', contentType: 'text/plain', size: 12 }] });

    const decision = await waiting;
    expect(decision).toMatchObject({ kind: 'retry' });
    expect(decision.kind === 'retry' && decision.message).toContain('Path: /tmp/log.txt');
    expect(decision.kind === 'retry' && decision.message).toContain('See this.');
  });

  it('should not run the timer again once the user asked for the retry', async () => {
    const ended = rs.fn();
    const waiting = service.wait('conv-1', FAILURE, 60_000, retryListener({ ended }));
    service.retryNow('conv-1');
    await waiting;

    rs.advanceTimersByTime(120_000);

    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('should stop retrying when the user ends the retries', async () => {
    const ended = rs.fn();
    const waiting = service.wait('conv-1', FAILURE, 60_000, retryListener({ ended }));

    expect(service.stopRetrying('conv-1')).toBe(true);

    await expect(waiting).resolves.toEqual({ kind: 'stop' });
    expect(ended).toHaveBeenCalledWith('stopped');
  });

  it('should reject the wait with a cancellation when the turn is cancelled', async () => {
    const ended = rs.fn();
    const waiting = service.wait('conv-1', FAILURE, 60_000, retryListener({ ended }));

    expect(service.cancel('conv-1')).toBe(true);

    await expect(waiting).rejects.toBeInstanceOf(PromptCancelledError);
    expect(ended).toHaveBeenCalledWith('cancelled');
    expect(service.hasPendingRetry('conv-1')).toBe(false);
  });

  it('should answer every wait of the conversation and leave the other conversations alone', async () => {
    const first = service.wait('conv-1', FAILURE, 60_000, retryListener());
    const second = service.wait('conv-1', FAILURE, 60_000, retryListener());
    const other = service.wait('conv-2', FAILURE, 60_000, retryListener());

    service.retryNow('conv-1');

    await expect(first).resolves.toEqual({ kind: 'retry' });
    await expect(second).resolves.toEqual({ kind: 'retry' });
    expect(service.hasPendingRetry('conv-2')).toBe(true);
    service.stopRetrying('conv-2');
    await expect(other).resolves.toEqual({ kind: 'stop' });
  });

  it('should keep a conversation pending while one of its waits remains', async () => {
    const first = service.wait('conv-1', FAILURE, 30_000, retryListener());
    void service.wait('conv-1', FAILURE, 60_000, retryListener());

    rs.advanceTimersByTime(30_000);
    await first;

    expect(service.hasPendingRetry('conv-1')).toBe(true);
  });

  it.each([
    ['retry now', (service: TurnRetryService) => service.retryNow('conv-1')],
    ['stop retrying', (service: TurnRetryService) => service.stopRetrying('conv-1')],
    ['cancel', (service: TurnRetryService) => service.cancel('conv-1')],
  ])('should report that nothing was waiting for %s', (_name, act) => {
    expect(act(service)).toBe(false);
  });
});
