import { describe, expect, it } from 'vitest';

import { parseAgyUsageOutput } from './agy-usage.util.js';


const sample = {
  conversation_id: '',
  status: 'SUCCESS',
  response: 'text',
  command: {
    name: 'usage',
    data: {
      description: 'Shared limits',
      groups: [
        {
          name: 'Gemini Models',
          description: 'Gemini Flash, Gemini Pro',
          buckets: [
            {
              id: 'gemini-weekly',
              name: 'Weekly Limit Remaining',
              description: 'resets soon',
              window: 'weekly',
              remaining_fraction: 0.94,
              reset_time: '2026-10-12T23:32:42Z',
            },
            { id: 'bad', name: 'Missing fields' },
          ],
        },
        { description: 'no name' },
        { name: 'No buckets' },
      ],
    },
  },
};

describe('parseAgyUsageOutput', () => {
  it('should map groups and buckets into the standard quota shape', () => {
    expect(parseAgyUsageOutput(JSON.stringify(sample))).toEqual({
      description: 'Shared limits',
      groups: [
        {
          name: 'Gemini Models',
          description: 'Gemini Flash, Gemini Pro',
          buckets: [
            {
              id: 'gemini-weekly',
              name: 'Weekly Limit Remaining',
              description: 'resets soon',
              window: 'weekly',
              remainingFraction: 0.94,
              resetTime: '2026-10-12T23:32:42Z',
            },
          ],
        },
      ],
    });
  });

  it('should ignore log noise around the JSON document', () => {
    const output = `warn: x\n${JSON.stringify(sample)}\ntrailing`;
    expect(parseAgyUsageOutput(output)?.groups).toHaveLength(1);
  });

  it('should return undefined for invalid or unsuccessful payloads', () => {
    expect(parseAgyUsageOutput('no json')).toBeUndefined();
    expect(parseAgyUsageOutput('{ not json }')).toBeUndefined();
    expect(
      parseAgyUsageOutput(JSON.stringify({ ...sample, status: 'ERROR' })),
    ).toBeUndefined();
    expect(
      parseAgyUsageOutput(JSON.stringify({ status: 'SUCCESS' })),
    ).toBeUndefined();
  });
});
