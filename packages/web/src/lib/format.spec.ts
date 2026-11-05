import { formatCountdown, formatDuration, formatRelativeTime } from './format.js';


describe('formatCountdown', () => {
  it.each([
    [20_000, '<1m'],
    [46 * 60_000, '46m'],
    [59 * 60_000, '59m'],
    [60 * 60_000, '1h'],
    [3 * 3_600_000, '3h'],
    [24 * 3_600_000, '1d'],
    [4 * 86_400_000, '4d'],
  ])('formats %d ms as %s', (duration, expected) => {
    expect(formatCountdown(duration)).toBe(expected);
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-01-10T12:00:00.000Z');

  it.each([
    ['2026-01-10T11:59:40.000Z', 'just now'],
    ['2026-01-10T11:55:00.000Z', '5 minutes ago'],
    ['2026-01-10T09:00:00.000Z', '3 hours ago'],
    ['2026-01-08T12:00:00.000Z', '2 days ago'],
  ])('formats %s', (iso, expected) => {
    expect(formatRelativeTime(iso, now)).toBe(expected);
  });

  it('defaults to the current time', () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe('just now');
  });
});

describe('formatDuration', () => {
  it.each([
    [400, '0 s'],
    [42_400, '42 s'],
    [60_000, '1m'],
    [550_000, '9m 10s'],
    [3_599_000, '59m 59s'],
    [3_600_000, '1h'],
    [3_900_000, '1h 5m'],
  ])('formats %i ms as %s', (durationMs, expected) => {
    expect(formatDuration(durationMs)).toBe(expected);
  });
});
