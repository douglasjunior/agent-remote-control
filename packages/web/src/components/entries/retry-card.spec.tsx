import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RetryCard } from './retry-card.js';


type RetryEntry = Extract<ConversationEntry, { type: 'retry' }>;

const NOW = Date.parse('2026-01-01T12:00:00Z');

const retry = (overrides: Partial<RetryEntry> = {}): RetryEntry => ({
  id: 'r1',
  at: '2026-01-01T12:00:00.000Z',
  type: 'retry',
  roleName: 'CEO',
  errorMessage: 'Service unavailable',
  attempt: 2,
  timeout: { expiresAt: NOW + 125_000, durationMs: 300_000 },
  closed: false,
  ...overrides,
});

function renderCard(entry: RetryEntry, handlers: { onRetryNow?: () => void; onStopRetrying?: () => void } = {}) {
  return render(<RetryCard entry={entry} onFocus={rs.fn()} onRetryNow={handlers.onRetryNow ?? rs.fn()} onStopRetrying={handlers.onStopRetrying ?? rs.fn()} />);
}

describe('RetryCard', () => {
  beforeEach(() => {
    rs.useFakeTimers();
    rs.setSystemTime(NOW);
  });

  afterEach(() => {
    rs.useRealTimers();
  });

  it('should show the error with the time left until the next attempt', () => {
    renderCard(retry());

    expect(screen.getByText('Service unavailable')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('Trying again automatically (attempt 2)');
    expect(screen.getByRole('timer')).toHaveTextContent('2:05');
  });

  it('should count the time down', () => {
    renderCard(retry());

    act(() => {
      rs.advanceTimersByTime(5000);
    });

    expect(screen.getByRole('timer')).toHaveTextContent('2:00');
  });

  it('should stop ticking once the time is spent', () => {
    renderCard(retry());

    act(() => {
      rs.advanceTimersByTime(125_000);
    });

    expect(screen.getByRole('timer')).toHaveTextContent('0:00');
    expect(rs.getTimerCount()).toBe(0);
  });

  it('should retry now or stop retrying from the buttons', async () => {
    rs.useRealTimers();
    const onRetryNow = rs.fn();
    const onStopRetrying = rs.fn();
    renderCard(retry(), { onRetryNow, onStopRetrying });

    await userEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stop retrying' }));

    expect(onRetryNow).toHaveBeenCalledTimes(1);
    expect(onStopRetrying).toHaveBeenCalledTimes(1);
  });

  it('should keep only the error once the wait is over', () => {
    renderCard(retry({ closed: true }));

    expect(screen.getByText('Service unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry now' })).not.toBeInTheDocument();
  });
});
