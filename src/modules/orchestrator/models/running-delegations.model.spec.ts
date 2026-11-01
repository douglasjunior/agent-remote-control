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
