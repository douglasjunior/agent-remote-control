import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';

import { PromptCancelledError } from '../../agent/ports/agent.port.js';
import { StubRuntimeSettings } from '../../settings/testing/stub-runtime-settings.js';
import { RetryBudget } from '../models/retry-budget.model.js';
import type { TurnRequest } from '../models/turn-request.model.js';
import type { RetryEvent, RetryMessage, RetryNote } from '../models/turn-retry.model.js';
import type { IAgentRegistryPort } from '../ports/agent-registry.port.js';
import { TurnRetryConfigService } from '../services/turn-retry-config.service.js';
import { TurnRetryService } from '../services/turn-retry.service.js';
import type { RetryPolicy } from '../utils/retry-delay.util.js';

import { RetryCeoRoundUseCase } from './retry-ceo-round.use-case.js';


const SECOND = 1000;
const MINUTE = 60 * SECOND;

describe('RetryCeoRoundUseCase', () => {
  let policy: RetryPolicy;
  let turnRetry: TurnRetryService;
  let useCase: RetryCeoRoundUseCase;
  let events: RetryEvent[];
  let drafts: string[];
  let request: TurnRequest;
  let prepared: RetryMessage[];

  beforeEach(() => {
    rs.useFakeTimers();
    rs.setSystemTime(1_000_000);
    policy = { baseDelayMs: 15 * SECOND, maxDelayMs: 2 * 60 * MINUTE, maxTotalMs: 5 * 60 * MINUTE };
    turnRetry = new TurnRetryService();
    const registry = { getDisplayName: (role: string) => `The ${role}` } as unknown as IAgentRegistryPort;
    useCase = new RetryCeoRoundUseCase(registry, turnRetry, new TurnRetryConfigService(new StubRuntimeSettings(() => ({ TURN_RETRY_BASE_DELAY_MS: policy.baseDelayMs, TURN_RETRY_MAX_DELAY_MS: policy.maxDelayMs, TURN_RETRY_MAX_TOTAL_MS: policy.maxTotalMs }))));
    events = [];
    drafts = [];
    prepared = [];
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

  const prepareMessage = async (message: RetryMessage) => {
    prepared.push(message);
    return message.text === '' ? undefined : `prepared: ${message.text}`;
  };

  /** Runs that throw each error in turn and then return `'done'`; `notes` collects the note each run received. */
  const attemptsThat = (...errors: unknown[]) => {
    const notes: (RetryNote | undefined)[] = [];
    const run = rs.fn(async (retry: RetryNote | undefined): Promise<string> => {
      notes.push(retry);
      const failure = errors[notes.length - 1];
      if (failure !== undefined) {
        throw failure;
      }
      return 'done';
    });
    return { run, notes };
  };

  const scheduledWaits = () => events.flatMap(event => (event.kind === 'scheduled' ? [[event.prompt.attempt, event.prompt.timeout.durationMs]] : []));

  describe('execute', () => {
    it('should return the result of the first attempt without telling the channel anything', async () => {
      const { run } = attemptsThat();

      await expect(useCase.execute(request, run, prepareMessage)).resolves.toBe('done');

      expect(run).toHaveBeenCalledTimes(1);
      expect(events).toEqual([]);
    });

    it('should show the failure, wait, and run again with the note of the error', async () => {
      const { run, notes } = attemptsThat(new Error('Service unavailable'));

      const result = useCase.execute(request, run, prepareMessage);
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

      await expect(result).resolves.toBe('done');
      expect(notes).toEqual([undefined, { errorMessage: 'Service unavailable' }]);
      expect(events.at(-1)).toEqual({ kind: 'ended', reason: 'elapsed' });
    });

    it('should wait twice as long after each failure', async () => {
      const { run } = attemptsThat(new Error('first'), new Error('second'), new Error('third'));

      const result = useCase.execute(request, run, prepareMessage);
      await rs.advanceTimersByTimeAsync(15 * SECOND);
      await rs.advanceTimersByTimeAsync(30 * SECOND);
      await rs.advanceTimersByTimeAsync(60 * SECOND);

      await expect(result).resolves.toBe('done');
      expect(scheduledWaits()).toEqual([[1, 15_000], [2, 30_000], [3, 60_000]]);
    });

    it('should retry at once when the user asks for it, carrying what they wrote once it is prepared', async () => {
      const { run, notes } = attemptsThat(new Error('Token expired'));

      const result = useCase.execute(request, run, prepareMessage);
      await rs.advanceTimersByTimeAsync(0);
      turnRetry.retryNow('conv-1', { text: 'I logged in again.' });

      await expect(result).resolves.toBe('done');
      expect(prepared).toEqual([{ text: 'I logged in again.', attachments: [] }]);
      expect(notes[1]).toEqual({ errorMessage: 'Token expired', userMessage: 'prepared: I logged in again.' });
      expect(events.at(-1)).toEqual({ kind: 'ended', reason: 'requested' });
    });

    it('should retry without a message when what the user wrote prepares to nothing', async () => {
      const { run, notes } = attemptsThat(new Error('Token expired'));

      const result = useCase.execute(request, run, prepareMessage);
      await rs.advanceTimersByTimeAsync(0);
      turnRetry.retryNow('conv-1', { text: '', attachments: [{ name: 'a.txt', path: '/a.txt', contentType: 'text/plain', size: 1 }] });

      await expect(result).resolves.toBe('done');
      expect(notes[1]).toEqual({ errorMessage: 'Token expired' });
    });

    it('should throw the error as it came when the user ends the retries', async () => {
      const failure = new Error('Quota reached');
      const { run } = attemptsThat(failure);

      const result = useCase.execute(request, run, prepareMessage);
      const rejected = expect(result).rejects.toBe(failure);
      await rs.advanceTimersByTimeAsync(0);
      turnRetry.stopRetrying('conv-1');

      await rejected;
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('should give up with the last failure once the time of the retries is spent, cutting the last wait', async () => {
      policy = { baseDelayMs: 15 * SECOND, maxDelayMs: 2 * 60 * MINUTE, maxTotalMs: 40 * SECOND };
      const failure = new Error('still down');
      const { run } = attemptsThat(new Error('down'), new Error('still down'), failure);

      const result = useCase.execute(request, run, prepareMessage);
      const rejected = expect(result).rejects.toBe(failure);
      await rs.advanceTimersByTimeAsync(15 * SECOND);
      await rs.advanceTimersByTimeAsync(25 * SECOND);

      await rejected;
      expect(run).toHaveBeenCalledTimes(3);
      expect(scheduledWaits().map(([, durationMs]) => durationMs)).toEqual([15_000, 25_000]);
    });

    it('should not wait at all when the retries are disabled', async () => {
      policy = { ...policy, maxTotalMs: 0 };
      const failure = new Error('boom');
      const { run } = attemptsThat(failure);

      await expect(useCase.execute(request, run, prepareMessage)).rejects.toBe(failure);

      expect(run).toHaveBeenCalledTimes(1);
      expect(events).toEqual([]);
    });

    it('should not retry a cancellation', async () => {
      const cancelled = new PromptCancelledError();
      const { run } = attemptsThat(cancelled);

      await expect(useCase.execute(request, run, prepareMessage)).rejects.toBe(cancelled);

      expect(run).toHaveBeenCalledTimes(1);
      expect(events).toEqual([]);
    });

    it('should end as cancelled when the turn is cancelled during the wait', async () => {
      const { run } = attemptsThat(new Error('boom'));

      const result = useCase.execute(request, run, prepareMessage);
      const rejected = expect(result).rejects.toBeInstanceOf(PromptCancelledError);
      await rs.advanceTimersByTimeAsync(0);
      turnRetry.cancel('conv-1');

      await rejected;
      expect(events.at(-1)).toEqual({ kind: 'ended', reason: 'cancelled' });
    });

    it('should tell the error even when the thrown value is not an Error', async () => {
      const { run } = attemptsThat('raw failure');

      const result = useCase.execute(request, run, prepareMessage);
      await rs.advanceTimersByTimeAsync(15 * SECOND);

      await expect(result).resolves.toBe('done');
      expect(events[0]).toMatchObject({ kind: 'scheduled', prompt: { errorMessage: 'raw failure' } });
    });

    it('should run without a channel listening', async () => {
      const quiet: TurnRequest = { conversationId: 'conv-1', userId: 'user-1', prompt: 'Hi', workspacePath: '/mock/workspace', agentRole: 'CEO' };
      const { run } = attemptsThat(new Error('boom'));

      const result = useCase.execute(quiet, run, prepareMessage);
      await rs.advanceTimersByTimeAsync(15 * SECOND);

      await expect(result).resolves.toBe('done');
    });

    it('should start the waits over for each prompt', async () => {
      const first = attemptsThat(new Error('one'));
      const second = attemptsThat(new Error('two'));

      const firstResult = useCase.execute(request, first.run, prepareMessage);
      await rs.advanceTimersByTimeAsync(15 * SECOND);
      await firstResult;
      const secondResult = useCase.execute(request, second.run, prepareMessage);
      await rs.advanceTimersByTimeAsync(15 * SECOND);
      await secondResult;

      expect(scheduledWaits()).toEqual([[1, 15_000], [1, 15_000]]);
    });
  });

  describe('pause', () => {
    it('should wait, then hand back the note of the failure, with what the user wrote prepared', async () => {
      const result = useCase.pause(request, 'Invalid CEO response: bad tag', new RetryBudget(), prepareMessage);
      await rs.advanceTimersByTimeAsync(0);
      turnRetry.retryNow('conv-1', { text: 'Use another role.' });

      await expect(result).resolves.toEqual({ errorMessage: 'Invalid CEO response: bad tag', userMessage: 'prepared: Use another role.' });
      expect(drafts).toEqual(['']);
      expect(events[0]).toMatchObject({ kind: 'scheduled', prompt: { errorMessage: 'Invalid CEO response: bad tag', attempt: 1 } });
    });

    it('should hand back the note alone when the time passes', async () => {
      const result = useCase.pause(request, 'bad', new RetryBudget(), prepareMessage);
      await rs.advanceTimersByTimeAsync(15 * SECOND);

      await expect(result).resolves.toEqual({ errorMessage: 'bad' });
      expect(prepared).toEqual([]);
    });

    it('should hand back nothing when the user ends the retries', async () => {
      const result = useCase.pause(request, 'bad', new RetryBudget(), prepareMessage);
      await rs.advanceTimersByTimeAsync(0);
      turnRetry.stopRetrying('conv-1');

      await expect(result).resolves.toBeUndefined();
    });

    it('should hand back nothing, without waiting, when the retries are disabled', async () => {
      policy = { ...policy, maxTotalMs: 0 };

      await expect(useCase.pause(request, 'bad', new RetryBudget(), prepareMessage)).resolves.toBeUndefined();

      expect(events).toEqual([]);
    });

    it('should double the wait of the budget it is given', async () => {
      const budget = new RetryBudget();

      const first = useCase.pause(request, 'bad', budget, prepareMessage);
      await rs.advanceTimersByTimeAsync(15 * SECOND);
      await first;
      const second = useCase.pause(request, 'bad', budget, prepareMessage);
      await rs.advanceTimersByTimeAsync(30 * SECOND);
      await second;

      expect(scheduledWaits()).toEqual([[1, 15_000], [2, 30_000]]);
    });

    it('should be cancelled with the turn', async () => {
      const result = useCase.pause(request, 'bad', new RetryBudget(), prepareMessage);
      const rejected = expect(result).rejects.toBeInstanceOf(PromptCancelledError);
      await rs.advanceTimersByTimeAsync(0);
      turnRetry.cancel('conv-1');

      await rejected;
    });
  });
});
