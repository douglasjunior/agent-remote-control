import { describe, expect, it } from 'vitest';

import { type DelegationOutcome, RunningDelegations } from './running-delegations.model.js';


const deferred = () => {
  let settle!: (outcome: DelegationOutcome) => void;
  const outcome = new Promise<DelegationOutcome>((resolve) => {
    settle = resolve;
  });
  return { outcome, settle };
};

const result = (block: string): DelegationOutcome => ({ kind: 'result', block });

describe('RunningDelegations', () => {
  it('should be empty until a delegation starts and again once its result is handed over', async () => {
    const running = new RunningDelegations();
    const developer = deferred();

    expect(running.isEmpty).toBe(true);

    running.add([{ role: 'DEVELOPER', outcome: developer.outcome }]);
    expect(running.isEmpty).toBe(false);
    expect(running.pendingRoles).toEqual(['DEVELOPER']);

    developer.settle(result('done'));
    expect(await running.nextResults()).toBe('done');
    expect(running.isEmpty).toBe(true);
    expect(running.pendingRoles).toEqual([]);
  });

  it('should hand over each result as soon as its agent finishes', async () => {
    const running = new RunningDelegations();
    const planner = deferred();
    const developer = deferred();
    running.add([
      { role: 'TECH_LEAD', outcome: planner.outcome },
      { role: 'DEVELOPER', outcome: developer.outcome },
    ]);

    developer.settle(result('implemented'));
    expect(await running.nextResults()).toBe('implemented');
    expect(running.pendingRoles).toEqual(['TECH_LEAD']);

    planner.settle(result('planned'));
    expect(await running.nextResults()).toBe('planned');
  });

  it('should batch the results that finished before they were asked for', async () => {
    const running = new RunningDelegations();
    const first = deferred();
    const second = deferred();
    running.add([
      { role: 'TECH_LEAD', outcome: first.outcome },
      { role: 'DEVELOPER', outcome: second.outcome },
    ]);

    first.settle(result('one'));
    second.settle(result('two'));
    await running.settled();

    expect(await running.nextResults()).toBe('one\n\ntwo');
  });

  it('should keep a finished result available while nothing else is running', async () => {
    const running = new RunningDelegations();
    const developer = deferred();
    running.add([{ role: 'DEVELOPER', outcome: developer.outcome }]);

    developer.settle(result('done'));
    await running.settled();

    expect(running.pendingRoles).toEqual([]);
    expect(running.isEmpty).toBe(false);
  });

  it('should throw the reason of a cancelled delegation', async () => {
    const running = new RunningDelegations();
    const developer = deferred();
    const reason = new Error('cancelled');
    running.add([{ role: 'DEVELOPER', outcome: developer.outcome }]);

    developer.settle({ kind: 'cancelled', reason });

    await expect(running.nextResults()).rejects.toBe(reason);
  });

  describe('replaced delegations', () => {
    const replaced: DelegationOutcome = { kind: 'replaced' };

    it('should not hand over a replaced delegation and keep waiting for a pending result', async () => {
      const running = new RunningDelegations();
      const old = deferred();
      const current = deferred();
      running.add([
        { role: 'DEVELOPER', outcome: old.outcome },
        { role: 'TECH_LEAD', outcome: current.outcome },
      ]);

      old.settle(replaced);
      await Promise.resolve();
      let handedOver: string | undefined;
      const waiting = running.nextResults().then((blocks) => {
        handedOver = blocks;
      });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(handedOver).toBeUndefined();
      expect(running.pendingRoles).toEqual(['TECH_LEAD']);

      current.settle(result('planned'));
      await waiting;

      expect(handedOver).toBe('planned');
    });

    it('should resolve to undefined and be empty when the only delegation was replaced', async () => {
      const running = new RunningDelegations();
      const developer = deferred();
      running.add([{ role: 'DEVELOPER', outcome: developer.outcome }]);

      developer.settle(replaced);

      await expect(running.nextResults()).resolves.toBeUndefined();
      expect(running.isEmpty).toBe(true);
    });

    it('should hand over the result of a batch that also holds a replaced delegation', async () => {
      const running = new RunningDelegations();
      const old = deferred();
      const current = deferred();
      running.add([
        { role: 'DEVELOPER', outcome: old.outcome },
        { role: 'TECH_LEAD', outcome: current.outcome },
      ]);

      old.settle(replaced);
      current.settle(result('planned'));
      await running.settled();

      await expect(running.nextResults()).resolves.toBe('planned');
      expect(running.isEmpty).toBe(true);
    });
  });

  it('should wait for every pending delegation to settle', async () => {
    const running = new RunningDelegations();
    const developer = deferred();
    running.add([{ role: 'DEVELOPER', outcome: developer.outcome }]);
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
