import type { AgentQuotaReport } from '@agent-remote-control/protocol/agent-quota';

import { bucketLabel, clampFraction, lowestFraction, quotaLevel, quotaPercent, tightestFraction, windowLabel } from './quota-level.js';


function report(...fractions: number[]): AgentQuotaReport {
  return {
    agent: { id: 'a', name: 'A' },
    status: 'ok',
    quota: {
      groups: [
        {
          name: 'Limits',
          buckets: fractions.map((remainingFraction, index) => ({ id: String(index), name: 'Bucket', window: '5h', remainingFraction })),
        },
      ],
    },
  };
}

describe('quota level', () => {
  it.each([
    [1, 'good'],
    [0.5, 'good'],
    [0.49, 'attention'],
    [0.2, 'attention'],
    [0.19, 'critical'],
    [0, 'critical'],
    [-1, 'critical'],
    [2, 'good'],
  ])('reads %d as %s', (fraction, level) => {
    expect(quotaLevel(fraction)).toBe(level);
  });

  it('keeps a fraction between 0 and 1', () => {
    expect(clampFraction(-0.5)).toBe(0);
    expect(clampFraction(1.5)).toBe(1);
    expect(clampFraction(0.3)).toBe(0.3);
  });

  it('rounds the percent of a clamped fraction', () => {
    expect(quotaPercent(0.126)).toBe(87);
    expect(quotaPercent(1)).toBe(0);
    expect(quotaPercent(1.5)).toBe(0);
    expect(quotaPercent(-1)).toBe(100);
  });

  it.each([
    ['5h', '5h'],
    ['7d', 'Week'],
    ['weekly', 'Week'],
    ['monthly', 'Month'],
    ['daily', 'Premium'],
  ])('labels the window %s as %s', (window, label) => {
    expect(windowLabel({ id: 'b', name: 'Premium', window, remainingFraction: 1 })).toBe(label);
  });

  it('labels a limit by its window while no sibling shares it', () => {
    const session = { id: 's', name: 'Current session', window: '5h', remainingFraction: 1 };
    const week = { id: 'w', name: 'Current week', window: '7d', remainingFraction: 1 };

    expect(bucketLabel(week, [session, week])).toBe('Week');
  });

  it('adds what tells apart the limits that share a window', () => {
    const all = { id: 'a', name: 'Current week (all models)', window: '7d', remainingFraction: 1 };
    const plain = { id: 'p', name: 'Extra week', window: 'weekly', remainingFraction: 1 };

    expect(bucketLabel(all, [all, plain])).toBe('Week · all models');
    expect(bucketLabel(plain, [all, plain])).toBe('Extra week');
  });

  it('finds the closest limit of an agent', () => {
    expect(tightestFraction(report(0.8, 0.3))).toBe(0.3);
    expect(tightestFraction(report())).toBeUndefined();
    expect(tightestFraction({ agent: { id: 'a', name: 'A' }, status: 'unsupported' })).toBeUndefined();
  });

  it('finds the closest limit across the agents, skipping those without one', () => {
    expect(lowestFraction([report(0.8), report(0.1), { agent: { id: 'a', name: 'A' }, status: 'failed' }])).toBe(0.1);
    expect(lowestFraction([{ agent: { id: 'a', name: 'A' }, status: 'failed' }])).toBeUndefined();
    expect(lowestFraction([])).toBeUndefined();
  });
});
