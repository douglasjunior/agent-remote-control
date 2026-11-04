import { describe, expect, it } from 'vitest';

import { parseClaudeUsageOutput } from './claude-usage.util.js';


const NOW = new Date('2026-10-30T20:00:00Z');

const OUTPUT = `You are currently using your subscription to power your Claude Code usage

Current session: 9% used · resets Oct 30, 11:29pm (America/Sao_Paulo)
Current week (all models): 16% used · resets Nov 5, 6:59pm (America/Sao_Paulo)

What's contributing to your usage?
  56%  Start fresh when you switch tasks · run /clear
`;

describe('parseClaudeUsageOutput', () => {
  it('should parse the session and weekly limits', () => {
    const quota = parseClaudeUsageOutput(OUTPUT, NOW);

    expect(quota?.groups).toHaveLength(1);
    expect(quota?.groups[0]?.buckets).toEqual([
      {
        id: 'current-session',
        name: 'Current session',
        window: '5h',
        remainingFraction: 0.91,
        resetTime: '2026-10-31T02:29:00.000Z',
      },
      {
        id: 'current-week-all-models',
        name: 'Current week (all models)',
        window: '7d',
        remainingFraction: 0.84,
        resetTime: '2026-11-05T21:59:00.000Z',
      },
    ]);
  });

  it('should resolve a reset without a date to the next occurrence', () => {
    const quota = parseClaudeUsageOutput(
      'Current session: 50% used · resets 1:05am (America/Sao_Paulo)',
      NOW,
    );

    expect(quota?.groups[0]?.buckets[0]?.resetTime).toBe('2026-10-31T04:05:00.000Z');
  });

  it('should roll a past date over to the next year', () => {
    const quota = parseClaudeUsageOutput(
      'Current week (Opus): 10% used · resets Jan 2, 12:00pm (UTC)',
      NOW,
    );

    expect(quota?.groups[0]?.buckets[0]).toMatchObject({
      window: '7d',
      resetTime: '2027-01-02T12:00:00.000Z',
    });
  });

  it('should use a generic window for unknown labels and clamp the fraction', () => {
    const quota = parseClaudeUsageOutput('Extra usage: 120% used', NOW);

    expect(quota?.groups[0]?.buckets[0]).toEqual({
      id: 'extra-usage',
      name: 'Extra usage',
      window: 'limit',
      remainingFraction: 0,
      resetTime: undefined,
    });
  });

  it('should omit resetTime when the reset text cannot be parsed', () => {
    const outputs = [
      'Current session: 5% used · resets sometime soon',
      'Current session: 5% used · resets Foo 3, 1:00pm (UTC)',
      'Current session: 5% used · resets Oct 30, 1:00pm (Not/AZone)',
    ];

    for (const output of outputs) {
      expect(parseClaudeUsageOutput(output, NOW)?.groups[0]?.buckets[0]?.resetTime)
        .toBeUndefined();
    }
  });

  it('should return undefined when there is no limit line', () => {
    expect(parseClaudeUsageOutput('Not logged in', NOW)).toBeUndefined();
    expect(parseClaudeUsageOutput('', NOW)).toBeUndefined();
  });

  it('should default now to the current time', () => {
    const quota = parseClaudeUsageOutput('Current session: 5% used · resets 1:00pm (UTC)');

    expect(quota?.groups[0]?.buckets[0]?.resetTime).toBeDefined();
  });
});
