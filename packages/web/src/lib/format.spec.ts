import { formatDuration, formatRelativeTime } from './format.js';


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
  it('rounds to whole seconds', () => {
    expect(formatDuration(42_400)).toBe('42 s');
  });
});
