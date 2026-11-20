import { afterEach, describe, expect, it, rs } from '@rstest/core';

import { type DelegationOutcome, RunningDelegations } from './running-delegations.model.js';


const deferred = () => {
  let settle!: (outcome: DelegationOutcome) => void;
  const outcome = new Promise<DelegationOutcome>((resolve) => {
    settle = resolve;
  });
  return { outcome, settle };
};

const result = (block: string): DelegationOutcome => ({ kind: 'result', block });
const started = ({ outcome }: ReturnType<typeof deferred>, cancel = rs.fn(async () => undefined)) => ({ outcome, cancel });

describe('RunningDelegations', () => {
  afterEach(() => {
    rs.useRealTimers();
  });

  it('should be empty until a delegation starts and again once its result is handed over', async () => {
    const running = new RunningDelegations();
    const developer = deferred();

    expect(running.isEmpty).toBe(true);

    running.add([started(developer)]);
    expect(running.isEmpty).toBe(false);

    developer.settle(result('done'));
    expect(await running.nextResults()).toBe('done');
    expect(running.isEmpty).toBe(true);
  });

  it('should hand over each result as soon as its agent finishes', async () => {
    const running = new RunningDelegations();
    const planner = deferred();
    const developer = deferred();
    running.add([
      started(planner),
      started(developer),
    ]);

    developer.settle(result('implemented'));
    expect(await running.nextResults()).toBe('implemented');

    planner.settle(result('planned'));
    expect(await running.nextResults()).toBe('planned');
  });

  it('should batch the results that finished before they were asked for', async () => {
    const running = new RunningDelegations();
    const first = deferred();
    const second = deferred();
    running.add([
      started(first),
      started(second),
    ]);

    first.settle(result('one'));
    second.settle(result('two'));
    await running.settled();

    expect(await running.nextResults()).toBe('one\n\ntwo');
  });

  it('should keep a finished result available while nothing else is running', async () => {
    const running = new RunningDelegations();
    const developer = deferred();
    running.add([started(developer)]);

    developer.settle(result('done'));
    await running.settled();

    expect(running.isEmpty).toBe(false);
  });

  it('should throw the reason of a cancelled delegation', async () => {
    const running = new RunningDelegations();
    const developer = deferred();
    const reason = new Error('cancelled');
    running.add([started(developer)]);

    developer.settle({ kind: 'cancelled', reason });

    await expect(running.nextResults()).rejects.toBe(reason);
  });

  describe.each<[string, DelegationOutcome]>([
    ['replaced', { kind: 'replaced' }],
    ['merged', { kind: 'merged' }],
  ])('%s delegations', (_kind, replaced) => {
    it('should not hand over a replaced delegation and keep waiting for a pending result', async () => {
      rs.useFakeTimers();
      const running = new RunningDelegations();
      const old = deferred();
      const current = deferred();
      running.add([
        started(old),
        started(current),
      ]);

      old.settle(replaced);
      await Promise.resolve();
      let handedOver: string | undefined;
      const waiting = running.nextResults().then((blocks) => {
        handedOver = blocks;
      });
      await rs.advanceTimersByTimeAsync(0);
      expect(handedOver).toBeUndefined();

      current.settle(result('planned'));
      await waiting;

      expect(handedOver).toBe('planned');
    });

    it('should resolve to an empty text and be empty when the only delegation was replaced', async () => {
      const running = new RunningDelegations();
      const developer = deferred();
      running.add([started(developer)]);

      developer.settle(replaced);

      await expect(running.nextResults()).resolves.toBe('');
      expect(running.isEmpty).toBe(true);
    });

    it('should hand over the result of a batch that also holds a replaced delegation', async () => {
      const running = new RunningDelegations();
      const old = deferred();
      const current = deferred();
      running.add([
        started(old),
        started(current),
      ]);

      old.settle(replaced);
      current.settle(result('planned'));
      await running.settled();

      await expect(running.nextResults()).resolves.toBe('planned');
      expect(running.isEmpty).toBe(true);
    });
  });

  describe('woken before a result', () => {
    it('should stop waiting with an empty text, keeping the delegations pending', async () => {
      const running = new RunningDelegations();
      const developer = deferred();
      running.add([started(developer)]);

      await expect(running.nextResults(Promise.resolve())).resolves.toBe('');
      expect(running.isEmpty).toBe(false);

      developer.settle(result('built'));
      await expect(running.nextResults(new Promise(() => undefined))).resolves.toBe('built');
    });

    it('should hand over the results already finished when woken', async () => {
      const running = new RunningDelegations();
      const developer = deferred();
      running.add([started(developer)]);
      developer.settle(result('built'));
      await running.settled();

      await expect(running.nextResults(Promise.resolve())).resolves.toBe('built');
    });
  });

  it('should cancel only the delegations still pending and wait for them to settle', async () => {
    const running = new RunningDelegations();
    const developer = deferred();
    const planner = deferred();
    const cancelDeveloper = rs.fn(async () => developer.settle({ kind: 'cancelled', reason: new Error('stopped') }));
    const cancelPlanner = rs.fn(async () => undefined);
    running.add([started(developer, cancelDeveloper), started(planner, cancelPlanner)]);
    planner.settle(result('planned'));
    expect(await running.nextResults()).toBe('planned');

    await running.cancelPending();

    expect(cancelDeveloper).toHaveBeenCalledTimes(1);
    expect(cancelPlanner).not.toHaveBeenCalled();
  });

  it('should wait for every pending delegation to settle', async () => {
    const running = new RunningDelegations();
    const developer = deferred();
    running.add([started(developer)]);
    let settled = false;

    const waiting = running.settled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    developer.settle(result('done'));
    await waiting;
    expect(settled).toBe(true);
  });
});
