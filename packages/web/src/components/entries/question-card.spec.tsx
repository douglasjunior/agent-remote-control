import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionProvider } from '../../connection/connection-context.js';
import { FakeServerConnection } from '../../test/fake-server-connection.js';

import { AnswerInputProvider } from './answer-input.js';
import { QuestionCard } from './question-card.js';


type QuestionEntry = Extract<ConversationEntry, { type: 'question' }>;

const NOW = Date.parse('2026-01-01T12:00:00Z');

const question = (overrides: Partial<QuestionEntry> = {}): QuestionEntry => ({
  id: 'q1',
  at: '2026-01-01T12:00:00.000Z',
  type: 'question',
  askerRole: 'DEVELOPER',
  askerRoleName: 'Developer',
  text: 'Which database?',
  options: ['Postgres', 'SQLite'],
  number: 1,
  total: 1,
  closed: false,
  ...overrides,
});

const renderCard = (entry: QuestionEntry, active = true) => render(
  <ConnectionProvider connection={new FakeServerConnection()}>
    <AnswerInputProvider conversationId="c1" questionId={entry.id} onAnswer={vi.fn()}>
      <QuestionCard entry={entry} active={active} onAnswer={vi.fn()} />
    </AnswerInputProvider>
  </ConnectionProvider>,
);

describe('QuestionCard countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows no countdown when the question never times out', () => {
    renderCard(question());

    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });

  it('counts down the time left and says the recommended answer is assumed', () => {
    renderCard(question({ recommendedIndex: 2, timeout: { expiresAt: NOW + 125_000, durationMs: 300_000 } }));

    expect(screen.getByRole('timer')).toHaveTextContent('2:05');
    expect(screen.getByRole('timer')).toHaveTextContent('The recommended answer is assumed');

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(screen.getByRole('timer')).toHaveTextContent('2:00');
  });

  it('says the agent carries on without an answer when no option is recommended', () => {
    renderCard(question({ timeout: { expiresAt: NOW + 60_000, durationMs: 60_000 } }));

    expect(screen.getByRole('timer')).toHaveTextContent('The agent carries on without an answer');
  });

  it('turns urgent in the last seconds and stops at zero', () => {
    renderCard(question({ timeout: { expiresAt: NOW + 31_000, durationMs: 300_000 } }));
    const clock = () => screen.getByRole('timer').querySelector('.font-mono')!;
    expect(clock()).not.toHaveClass('text-destructive');

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(clock()).toHaveClass('text-destructive');

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(clock()).toHaveTextContent('0:00');
  });

  it('marks the recommended option', () => {
    renderCard(question({ recommendedIndex: 2 }));

    expect(screen.getAllByText('Recommended')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /SQLite/ })).toHaveTextContent('Recommended');
  });

  it('shows no countdown on a question that is no longer active', () => {
    renderCard(question({ closed: true, timeout: { expiresAt: NOW + 60_000, durationMs: 60_000 } }), false);

    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });
});
