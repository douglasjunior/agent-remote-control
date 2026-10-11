import { describe, expect, it } from 'vitest';

import { parseCopilotUserOutput } from './copilot-usage.util.js';


const sample = {
  copilot_plan: 'individual',
  quota_reset_date_utc: '2026-11-01T00:00:00.000Z',
  quota_snapshots: {
    chat: { quota_id: 'chat', unlimited: true, percent_remaining: 100 },
    premium_interactions: {
      quota_id: 'premium_interactions',
      unlimited: false,
      percent_remaining: 50.6,
      remaining: 760,
      entitlement: 1500,
    },
    custom_thing: { percent_remaining: 10 },
    broken: { unlimited: false },
  },
};

describe('parseCopilotUserOutput', () => {
  it('should map limited snapshots to monthly buckets', () => {
    expect(parseCopilotUserOutput(JSON.stringify(sample))).toEqual({
      groups: [
        {
          name: 'GitHub Copilot',
          description: 'Plan: individual',
          buckets: [
            {
              id: 'premium_interactions',
              name: 'Premium Requests Remaining',
              window: 'monthly',
              remainingFraction: 0.506,
              resetTime: '2026-11-01T00:00:00.000Z',
              description: '760 of 1500 remaining',
            },
            {
              id: 'custom_thing',
              name: 'Custom Thing Remaining',
              window: 'monthly',
              remainingFraction: 0.1,
              resetTime: '2026-11-01T00:00:00.000Z',
              description: undefined,
            },
          ],
        },
      ],
    });
  });

  it('should omit plan and reset time when absent', () => {
    const quota = parseCopilotUserOutput(
      JSON.stringify({ quota_snapshots: { a: { percent_remaining: 5 } } }),
    );
    expect(quota?.groups[0]?.description).toBeUndefined();
    expect(quota?.groups[0]?.buckets[0]?.resetTime).toBeUndefined();
  });

  it('should return undefined for invalid payloads', () => {
    expect(parseCopilotUserOutput('not json')).toBeUndefined();
    expect(parseCopilotUserOutput('null')).toBeUndefined();
    expect(parseCopilotUserOutput('{}')).toBeUndefined();
  });
});
