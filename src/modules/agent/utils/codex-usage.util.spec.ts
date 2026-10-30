import { describe, expect, it } from 'vitest';

import { parseCodexRateLimits } from './codex-usage.util.js';


describe('parseCodexRateLimits', () => {
  it('should map the primary and secondary windows', () => {
    const quota = parseCodexRateLimits({
      rateLimits: {
        primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_793_413_800 },
        secondary: { usedPercent: 60.5, windowDurationMins: 10_080, resetsAt: 1_793_916_000 },
      },
    });

    expect(quota?.groups).toEqual([
      {
        name: 'Codex',
        buckets: [
          {
            id: 'primary',
            name: '5h limit',
            window: '5h',
            remainingFraction: 0.75,
            resetTime: '2026-10-31T02:30:00.000Z',
          },
          {
            id: 'secondary',
            name: '7d limit',
            window: '7d',
            remainingFraction: 0.395,
            resetTime: '2026-11-05T22:00:00.000Z',
          },
        ],
      },
    ]);
  });

  it('should name windows by minutes and clamp the fraction', () => {
    const quota = parseCodexRateLimits({
      rateLimits: { primary: { usedPercent: 130, windowDurationMins: 45 } },
    });

    expect(quota?.groups[0]?.buckets[0]).toEqual({
      id: 'primary',
      name: '45m limit',
      window: '45m',
      remainingFraction: 0,
      resetTime: undefined,
    });
  });

  it('should fall back to the window key without a duration', () => {
    const quota = parseCodexRateLimits({
      rateLimits: { secondary: { usedPercent: 10, windowDurationMins: null } },
    });

    expect(quota?.groups[0]?.buckets[0]).toMatchObject({
      name: 'secondary limit',
      window: 'secondary',
    });
  });

  it('should return undefined when no window is reported', () => {
    expect(parseCodexRateLimits({ rateLimits: { primary: null, secondary: null } })).toBeUndefined();
    expect(parseCodexRateLimits({ rateLimits: { primary: { usedPercent: 'x' } } })).toBeUndefined();
    expect(parseCodexRateLimits({ rateLimits: [] })).toBeUndefined();
    expect(parseCodexRateLimits({})).toBeUndefined();
    expect(parseCodexRateLimits(null)).toBeUndefined();
  });
});
