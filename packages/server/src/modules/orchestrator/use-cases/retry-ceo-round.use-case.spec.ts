import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';

import { PromptCancelledError } from '../../agent/ports/agent.port.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { RetryEvent, RetryNote } from '../models/turn-retry.model.js';
import type { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { TurnRetryService } from '../services/turn-retry.service.js';
import type { RetryPolicy } from '../utils/retry-delay.util.js';

import { RetryCeoRoundUseCase } from './retry-ceo-round.use-case.js';


type Outcome = { readonly kind: 'ok' | 'invalid' };

const SECOND = 1000;
const MINUTE = 60 * SECOND;

describe('RetryCeoRoundUseCase', () => {
  let policy: RetryPolicy;
  let turnRetry: TurnRetryService;
  let useCase: RetryCeoRoundUseCase;
  let events: RetryEvent[];
  let drafts: string[];
  let request: TurnRequest;

  beforeEach(() => {
    rs.useFakeTimers();
    rs.setSystemTime(1_000_000);
    policy = { baseDelayMs: 15 * SECOND, maxDelayMs: 2 * 60 * MINUTE, maxTotalMs: 5 * 60 * MINUTE };
    turnRetry = new TurnRetryService();
    const registry = { getDisplayName: (role: string) => `The ${role}` } as unknown as IAgentRegistryPort;
    useCase = new RetryCeoRoundUseCase(registry, turnRetry, { getPolicy: () => policy });
    events = [];
    drafts = [];
    request = {
      conversationId: 'conv-1',
      userId: 'user-1',
      prompt: 'Hi',
      workspacePath: '/mock/workspace',
      agentRole: 'CEO',
      onRetry: event => events.push(event),
      onDraft: text => drafts.push(text),
    };
  });

  afterEach(() => {
    rs.useRealTimers();
  });

  const okOutcome: Outcome = { kind: 'ok' };
  const invalidOutcome: Outcome = { kind: 'invalid' };
  const invalidAsFailure = (outcome: Outcome) => (outcome.kind === 'invalid' ? 'Invalid response' : undefined);

  const attemptsThat = (...results: (Outcome | Error)[]) => {
    const notes: (RetryNote | undefined)[] = [];
    const run = rs.fn(async (retry: RetryNote | undefined): Promise<Outcome> => {
      notes.push(retry);
      const result = results[notes.length - 1] ?? okOutcome;
      if (result instanceof Error) {
        throw result;
      }
      return result;
    });
    return { run, notes };
  };

  it('should return the outcome of the first attempt without telling the channel anything', async () => {
    const { run } = attemptsThat(okOutcome);

    await expect(useCase.execute(request, run, invalidAsFailure)).resolves.toBe(okOutcome);

    expect(run).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
  });

  it('should show the failure, wait, and run the round again with the note of the error', async () => {
    const { run, notes } = attemptsThat(new Error('Service unavailable'), okOutcome);

    const result = useCase.execute(request, run, invalidAsFailure);
    await rs.advanceTimersByTimeAsync(0);

    expect(events).toEqual([
      {
        kind: 'scheduled',
        prompt: { roleName: 'The CEO', errorMessage: 'Service unavailable', attempt: 1, timeout: { expiresAt: 1_015_000, durationMs: 15_000 } },
      },
    ]);
    expect(drafts).toEqual(['']);
    expect(run).toHaveBeenCalledTimes(1);

    await rs.advanceTimersByTimeAsync(15 * SECOND);

    await expect(result).resolves.toBe(okOutcome);
    expect(notes).toEqual([undefined, { errorMessage: 'Service unavailable' }]);
    expect(events.at(-1)).toEqual({ kind: 'ended', reason: 'elapsed' });
  });

  it('should retry a round whose outcome the caller refuses, and hand over the outcome that works', async () => {
    const { run, notes } = attemptsThat(invalidOutcome, okOutcome);

    const result = useCase.execute(request, run, invalidAsFailure);
    await rs.advanceTimersByTimeAsync(15 * SECOND);

    await expect(result).resolves.toBe(okOutcome);
    expect(notes[1]).toEqual({ errorMessage: 'Invalid response' });
  });

  it('should wait twice as long after each failure', async () => {
    const { run } = attemptsThat(new Error('first'), new Error('second'), new Error('third'), okOutcome);

    const result = useCase.execute(request, run, invalidAsFailure);
    await rs.advanceTimersByTimeAsync(15 * SECOND);
    await rs.advanceTimersByTimeAsync(30 * SECOND);
    await rs.advanceTimersByTimeAsync(60 * SECOND);

    await expect(result).resolves.toBe(okOutcome);
    const waits = events.flatMap(event => (event.kind === 'scheduled' ? [[event.prompt.attempt, event.prompt.timeout.durationMs]] : []));
    expect(waits).toEqual([[1, 15_000], [2, 30_000], [3, 60_000]]);
  });

  it('should retry at once when the user asks for it, carrying what they wrote', async () => {
    const { run, notes } = attemptsThat(new Error('Token expired'), okOutcome);

    const result = useCase.execute(request, run, invalidAsFailure);
    await rs.advanceTimersByTimeAsync(0);
    turnRetry.retryNow('conv-1', { text: 'I logged in again.' });

    await expect(result).resolves.toBe(okOutcome);
    expect(notes[1]).toEqual({ errorMessage: 'Token expired', userMessage: 'I logged in again.' });
    expect(events.at(-1)).toEqual({ kind: 'ended', reason: 'requested' });
  });

  it('should throw the error as it came when the user ends the retries', async () => {
    const failure = new Error('Quota reached');
    const { run } = attemptsThat(failure);

    const result = useCase.execute(request, run, invalidAsFailure);
    const rejected = expect(result).rejects.toBe(failure);
    await rs.advanceTimersByTimeAsync(0);
    turnRetry.stopRetrying('conv-1');

    await rejected;
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('should hand back the refused outcome when the user ends the retries', async () => {
    const { run } = attemptsThat(invalidOutcome);

    const result = useCase.execute(request, run, invalidAsFailure);
    await rs.advanceTimersByTimeAsync(0);
    turnRetry.stopRetrying('conv-1');

    await expect(result).resolves.toBe(invalidOutcome);
  });

  it('should give up with the last failure once the time of the retries is spent, cutting the last wait', async () => {
    policy = { baseDelayMs: 15 * SECOND, maxDelayMs: 2 * 60 * MINUTE, maxTotalMs: 20 * SECOND };
    const failure = new Error('still down');
    const { run } = attemptsThat(new Error('down'), new Error('still down'), failure);

    const result = useCase.execute(request, run, invalidAsFailure);
    const rejected = expect(result).rejects.toBe(failure);
    await rs.advanceTimersByTimeAsync(15 * SECOND);
    await rs.advanceTimersByTimeAsync(5 * SECOND);

    await rejected;
    expect(run).toHaveBeenCalledTimes(3);
    const waits = events.flatMap(event => (event.kind === 'scheduled' ? [event.prompt.timeout.durationMs] : []));
    expect(waits).toEqual([15_000, 5_000]);
  });

  it('should not wait at all when the retries are disabled', async () => {
    policy = { ...policy, maxTotalMs: 0 };
    const failure = new Error('boom');
    const { run } = attemptsThat(failure);

    await expect(useCase.execute(request, run, invalidAsFailure)).rejects.toBe(failure);

    expect(run).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
  });

  it('should not retry a cancellation', async () => {
    const cancelled = new PromptCancelledError();
    const { run } = attemptsThat(cancelled);

    await expect(useCase.execute(request, run, invalidAsFailure)).rejects.toBe(cancelled);

    expect(run).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
  });

  it('should end as cancelled when the turn is cancelled during the wait', async () => {
    const { run } = attemptsThat(new Error('boom'));

    const result = useCase.execute(request, run, invalidAsFailure);
    const rejected = expect(result).rejects.toBeInstanceOf(PromptCancelledError);
    await rs.advanceTimersByTimeAsync(0);
    turnRetry.cancel('conv-1');

    await rejected;
    expect(events.at(-1)).toEqual({ kind: 'ended', reason: 'cancelled' });
  });

  it('should tell the error even when the thrown value is not an Error', async () => {
    const run = rs.fn(async (retry: RetryNote | undefined): Promise<Outcome> => {
      if (!retry) {
        throw 'raw failure';
      }
      return okOutcome;
    });

    const result = useCase.execute(request, run, invalidAsFailure);
    await rs.advanceTimersByTimeAsync(15 * SECOND);

    await expect(result).resolves.toBe(okOutcome);
    expect(events[0]).toMatchObject({ kind: 'scheduled', prompt: { errorMessage: 'raw failure' } });
  });

  it('should run without a channel listening', async () => {
    const quiet: TurnRequest = { conversationId: 'conv-1', userId: 'user-1', prompt: 'Hi', workspacePath: '/mock/workspace', agentRole: 'CEO' };
    const { run } = attemptsThat(new Error('boom'), okOutcome);

    const result = useCase.execute(quiet, run, invalidAsFailure);
    await rs.advanceTimersByTimeAsync(15 * SECOND);

    await expect(result).resolves.toBe(okOutcome);
  });
});
