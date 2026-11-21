import { describe, expect, it, rs } from '@rstest/core';

import { DelegationControl, type FollowUp } from './delegation-control.model.js';


const control = () => new DelegationControl({ runId: 'run-1', summary: 'Building', updates: ['Use JWT.'], contextSince: '2026-01-01T00:00:00.000Z' });
const followUp = (text: string): FollowUp => ({ instruction: { text, summary: text }, request: {} as never, round: 1, settle: rs.fn() });

describe('DelegationControl', () => {
  it('should record each instruction after the task and take the summary of the last one', () => {
    const delegation = control();

    delegation.record({ text: 'Add tests.', summary: 'Testing' });

    expect(delegation.updates).toEqual(['Use JWT.', 'Add tests.']);
    expect(delegation.summary).toBe('Testing');
  });

  it('should hand the kept instructions to one prompt, settling the interruption they asked for', () => {
    const delegation = control();

    expect(delegation.keep({ text: 'A', summary: 'a' })).toBe(true);
    expect(delegation.keep({ text: 'B', summary: 'b' }, true)).toBe(true);

    expect(delegation.take().map(instruction => instruction.text)).toEqual(['A', 'B']);
    expect(delegation.take()).toEqual([]);
    expect(delegation.takeInterruption()).toBe(false);
  });

  it('should tell once that a prompt was cancelled to deliver an instruction', () => {
    const delegation = control();
    delegation.keep({ text: 'A', summary: 'a' }, true);

    expect(delegation.takeInterruption()).toBe(true);
    expect(delegation.takeInterruption()).toBe(false);
  });

  it('should end a run only when nothing is kept for another prompt, and take nothing more once it ended', () => {
    const delegation = control();
    delegation.keep({ text: 'A', summary: 'a' });

    expect(delegation.seal()).toBe(false);
    delegation.take();
    expect(delegation.seal()).toBe(true);
    expect(delegation.acceptsInstructions).toBe(false);
    expect(delegation.keep({ text: 'B', summary: 'b' })).toBe(false);
  });

  it('should open a run for each follow-up in order and close once none is left', () => {
    const delegation = control();
    const first = followUp('first');
    const second = followUp('second');
    delegation.follow(first);
    delegation.follow(second);
    delegation.seal();

    expect(delegation.queued).toBe(2);
    expect(delegation.next()).toBe(first);
    expect(delegation.acceptsInstructions).toBe(true);
    expect(delegation.next()).toBe(second);
    expect(delegation.next()).toBeUndefined();
    expect(delegation.follow(followUp('late'))).toBe(false);
  });

  it('should take back only a follow-up that has not started', () => {
    const delegation = control();
    const queued = followUp('queued');
    delegation.follow(queued);

    expect(delegation.withdraw(queued)).toBe(true);
    expect(delegation.withdraw(queued)).toBe(false);
    expect(delegation.queued).toBe(0);
  });

  it('should count each waiting delegation once, however often it stops waiting', () => {
    const delegation = control();
    const release = delegation.addWaiter();
    delegation.addWaiter();

    release();
    release();

    expect(delegation.queued).toBe(1);
  });

  it('should hand back the follow-ups that never ran when it closes, and tell how it ended', async () => {
    const delegation = control();
    const unrun = followUp('unrun');
    delegation.follow(unrun);

    expect(delegation.close()).toEqual([unrun]);
    expect(delegation.follow(followUp('late'))).toBe(false);
    delegation.finish('failed');
    await expect(delegation.ended).resolves.toBe('failed');
  });
});
